import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { ApiError, NetworkError } from "../api/client"
import { Autosave, type SaveOptions, type SaveState } from "./autosave"

type Snapshot = { title: string }

function setup(
  save: (snapshot: Snapshot, options: SaveOptions) => Promise<{ rev: string }>,
  extra: { online?: () => boolean } = {},
) {
  const states: SaveState["kind"][] = []
  const stash = { write: vi.fn(), clear: vi.fn() }
  const autosave = new Autosave<Snapshot>({
    delay: 1500,
    retryDelay: 10_000,
    initialRev: "r1",
    save,
    stash,
    onState: (state) => states.push(state.kind),
    isOnline: extra.online,
  })
  return { autosave, states, stash }
}

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe("デバウンス", () => {
  test("入力が止まって 1.5 秒後に 1 回だけ保存し、最後の値と _rev を送る", async () => {
    const save = vi.fn(async () => ({ rev: "r2" }))
    const { autosave, stash } = setup(save)
    autosave.change({ title: "a" })
    await vi.advanceTimersByTimeAsync(1000)
    autosave.change({ title: "ab" })
    await vi.advanceTimersByTimeAsync(1000)
    autosave.change({ title: "abc" })
    expect(save).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1500)
    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledWith(
      { title: "abc" },
      { rev: "r1", explicit: false, overrideLock: false },
    )
    expect(autosave.rev).toBe("r2")
    expect(autosave.state.kind).toBe("saved")
    // 入力のたびに端末へ退避し、保存できたら消す
    expect(stash.write).toHaveBeenCalledTimes(3)
    expect(stash.clear).toHaveBeenCalledTimes(1)
  })

  test("変更が無ければ保存しない (開いただけでは保存されない)", async () => {
    const save = vi.fn(async () => ({ rev: "r2" }))
    const { autosave } = setup(save)
    await vi.advanceTimersByTimeAsync(10_000)
    await autosave.flush()
    expect(save).not.toHaveBeenCalled()
    expect(autosave.state.kind).toBe("idle")
  })

  test("⌘S (flush) はすぐ保存し、explicit を付ける", async () => {
    const save = vi.fn(async () => ({ rev: "r2" }))
    const { autosave } = setup(save)
    autosave.change({ title: "a" })
    await autosave.flush(true)
    expect(save).toHaveBeenCalledWith(
      { title: "a" },
      { rev: "r1", explicit: true, overrideLock: false },
    )
  })

  test("保存中の入力は、終わってから次の _rev で保存する (同時に送らない)", async () => {
    let resolveFirst: (value: { rev: string }) => void = () => {}
    const save = vi
      .fn<
        (snapshot: Snapshot, options: SaveOptions) => Promise<{ rev: string }>
      >()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve
          }),
      )
      .mockImplementation(async () => ({ rev: "r3" }))
    const { autosave } = setup(save)
    autosave.change({ title: "a" })
    await vi.advanceTimersByTimeAsync(1500)
    expect(save).toHaveBeenCalledTimes(1)
    autosave.change({ title: "ab" })
    await vi.advanceTimersByTimeAsync(1500)
    // 1 本目が終わっていないので 2 本目はまだ
    expect(save).toHaveBeenCalledTimes(1)
    resolveFirst({ rev: "r2" })
    await vi.advanceTimersByTimeAsync(0)
    expect(save).toHaveBeenCalledTimes(2)
    expect(save.mock.calls[1]).toEqual([
      { title: "ab" },
      { rev: "r2", explicit: false, overrideLock: false },
    ])
    expect(autosave.rev).toBe("r3")
    expect(autosave.state.kind).toBe("saved")
  })
})

describe("送れないとき", () => {
  test("blockedReason があれば送らずに waiting にし、端末には残す", async () => {
    const save = vi.fn(async () => ({ rev: "r2" }))
    const stash = { write: vi.fn(), clear: vi.fn() }
    let reason: string | null = "slug を入力すると保存されます"
    const autosave = new Autosave<Snapshot>({
      initialRev: undefined,
      save,
      stash,
      blockedReason: () => reason,
    })
    autosave.change({ title: "a" })
    await vi.advanceTimersByTimeAsync(1500)
    expect(save).not.toHaveBeenCalled()
    expect(autosave.state).toEqual({
      kind: "waiting",
      message: "slug を入力すると保存されます",
    })
    expect(stash.write).toHaveBeenCalledWith({ title: "a" })
    reason = null
    autosave.change({ title: "ab" })
    await vi.advanceTimersByTimeAsync(1500)
    expect(save).toHaveBeenCalledTimes(1)
  })
})

describe("衝突", () => {
  test("409 CONFLICT で止まり、上書きを選ぶと最新の _rev で保存する", async () => {
    const save = vi
      .fn<
        (snapshot: Snapshot, options: SaveOptions) => Promise<{ rev: string }>
      >()
      .mockRejectedValueOnce(
        new ApiError(409, "CONFLICT", "Content has been modified"),
      )
      .mockResolvedValue({ rev: "r9" })
    const { autosave, stash } = setup(save)
    autosave.change({ title: "a" })
    await vi.advanceTimersByTimeAsync(1500)
    expect(autosave.state.kind).toBe("conflict")
    // 衝突中は入力しても自動では送らない
    autosave.change({ title: "ab" })
    await vi.advanceTimersByTimeAsync(5000)
    expect(save).toHaveBeenCalledTimes(1)
    expect(stash.clear).not.toHaveBeenCalled()
    await autosave.resolveConflict("overwrite", "r8")
    expect(save).toHaveBeenCalledTimes(2)
    expect(save.mock.calls[1]).toEqual([
      { title: "ab" },
      { rev: "r8", explicit: true, overrideLock: false },
    ])
    expect(autosave.state.kind).toBe("saved")
  })

  test("再読込を選ぶと未保存の値と退避を捨てる", async () => {
    const save = vi.fn(async () => {
      throw new ApiError(409, "CONFLICT", "conflict")
    })
    const { autosave, stash } = setup(save)
    autosave.change({ title: "a" })
    await vi.advanceTimersByTimeAsync(1500)
    await autosave.resolveConflict("reload", "r8")
    expect(autosave.hasUnsaved).toBe(false)
    expect(autosave.rev).toBe("r8")
    expect(stash.clear).toHaveBeenCalled()
    expect(autosave.state.kind).toBe("idle")
  })

  test("他の人の編集ロック (ENTRY_LOCKED) は locked になり、上書きで overrideLock を付ける", async () => {
    const holder = {
      userId: "u2",
      userName: "他の人",
      acquiredAt: "a",
      expiresAt: "b",
    }
    const save = vi
      .fn<
        (snapshot: Snapshot, options: SaveOptions) => Promise<{ rev: string }>
      >()
      .mockRejectedValueOnce(
        new ApiError(409, "ENTRY_LOCKED", "locked", holder),
      )
      .mockResolvedValue({ rev: "r2" })
    const { autosave } = setup(save)
    autosave.change({ title: "a" })
    await vi.advanceTimersByTimeAsync(1500)
    expect(autosave.state).toEqual({
      kind: "locked",
      holder,
      message: "locked",
    })
    await autosave.overrideLockAndSave()
    expect(save.mock.calls[1][1].overrideLock).toBe(true)
    expect(autosave.state.kind).toBe("saved")
  })
})

describe("オフライン", () => {
  test("通信できないと offline になり、退避を残して後で送り直す", async () => {
    const save = vi
      .fn<
        (snapshot: Snapshot, options: SaveOptions) => Promise<{ rev: string }>
      >()
      .mockRejectedValueOnce(new NetworkError(new TypeError("offline")))
      .mockResolvedValue({ rev: "r2" })
    const { autosave, stash } = setup(save)
    autosave.change({ title: "a" })
    await vi.advanceTimersByTimeAsync(1500)
    expect(autosave.state.kind).toBe("offline")
    expect(stash.write).toHaveBeenCalledWith({ title: "a" })
    expect(stash.clear).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(save).toHaveBeenCalledTimes(2)
    expect(autosave.state.kind).toBe("saved")
    expect(stash.clear).toHaveBeenCalled()
  })

  test("navigator.onLine が false のときは送らずに待ち、retry で送る", async () => {
    let online = false
    const save = vi.fn(async () => ({ rev: "r2" }))
    const { autosave } = setup(save, { online: () => online })
    autosave.change({ title: "a" })
    await vi.advanceTimersByTimeAsync(1500)
    expect(save).not.toHaveBeenCalled()
    expect(autosave.state.kind).toBe("offline")
    online = true
    autosave.retry()
    await vi.advanceTimersByTimeAsync(0)
    expect(save).toHaveBeenCalledTimes(1)
  })

  test("その他のエラーは error にして値は残す", async () => {
    const save = vi.fn(async () => {
      throw new ApiError(400, "VALIDATION_ERROR", "title is required")
    })
    const { autosave } = setup(save)
    autosave.change({ title: "" })
    await vi.advanceTimersByTimeAsync(1500)
    expect(autosave.state).toEqual({
      kind: "error",
      message: "title is required",
    })
    expect(autosave.hasUnsaved).toBe(true)
  })
})
