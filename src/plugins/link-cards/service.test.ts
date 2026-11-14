import { describe, expect, it } from "vitest"
import type { OgpRecord } from "../../../lib/ogp-fetcher"
import {
  consumeRateLimit,
  createLinkCardService,
  InvalidUrlError,
  mapLimit,
  type RateStore,
  type RecordStore,
} from "./service"

const LEGACY = "https://github.com/actions/runner/releases"

function memoryStore(initial: Record<string, OgpRecord> = {}) {
  const rows = new Map(Object.entries(initial))
  const puts: string[] = []
  const store: RecordStore = {
    get: async (id) => rows.get(id) ?? null,
    getMany: async (ids) =>
      new Map(ids.flatMap((id) => (rows.has(id) ? [[id, rows.get(id)!]] : []))),
    put: async (id, data) => {
      puts.push(id)
      rows.set(id, data)
    },
  }
  return { store, rows, puts }
}

function ok(url: string, title = "Fetched"): OgpRecord {
  return {
    url,
    data: { url, title, domain: new URL(url).hostname },
    fetchedAt: 10,
  }
}

function failed(url: string, retryAfter: number): OgpRecord {
  return { url, data: null, fetchedAt: 10, error: "HTTP 500", retryAfter }
}

describe("createLinkCardService().lookup", () => {
  it("保存済みならそれを返し、取りに行かない", async () => {
    const { store } = memoryStore({
      "https://example.com/": ok("https://example.com/", "Stored"),
    })
    const fetched: string[] = []
    const service = createLinkCardService({
      store,
      fetchRecord: async (url) => {
        fetched.push(url)
        return ok(url)
      },
    })
    const result = await service.lookup("https://EXAMPLE.com", { fetch: true })
    expect(result).toMatchObject({
      url: "https://example.com/",
      status: "ok",
      source: "stored",
      data: { title: "Stored" },
    })
    expect(fetched).toEqual([])
  })

  it("ストレージに無ければ JSON (既存の 12 件)", async () => {
    const { store } = memoryStore()
    const service = createLinkCardService({
      store,
      fetchRecord: async () => {
        throw new Error("should not fetch")
      },
    })
    const result = await service.lookup(LEGACY, { fetch: true })
    expect(result).toMatchObject({
      status: "ok",
      source: "legacy",
      data: { title: "Releases · actions/runner" },
    })
  })

  it("どちらにも無ければ取って保存する (beforeFetch を呼ぶ)", async () => {
    const { store, rows } = memoryStore()
    let limited = 0
    const service = createLinkCardService({
      store,
      fetchRecord: async (url) => ok(url),
    })
    const result = await service.lookup("https://example.com/new", {
      fetch: true,
      beforeFetch: async () => {
        limited++
      },
    })
    expect(result).toMatchObject({ status: "ok", source: "fetched" })
    expect(limited).toBe(1)
    expect(rows.get("https://example.com/new")?.data?.title).toBe("Fetched")
  })

  it("fetch: false なら取りに行かない", async () => {
    const service = createLinkCardService({
      store: memoryStore().store,
      fetchRecord: async () => {
        throw new Error("should not fetch")
      },
    })
    expect(
      await service.lookup("https://example.com/x", { fetch: false }),
    ).toMatchObject({ status: "missing", source: "none" })
  })

  it("失敗した URL は再試行の時刻までは取り直さない", async () => {
    const url = "https://example.com/broken"
    const { store } = memoryStore({ [url]: failed(url, 1000) })
    const fetched: string[] = []
    const fetchRecord = async (target: string) => {
      fetched.push(target)
      return ok(target)
    }
    const early = createLinkCardService({ store, fetchRecord, now: () => 999 })
    expect(await early.lookup(url, { fetch: true })).toMatchObject({
      status: "failed",
      source: "stored",
      error: "HTTP 500",
      retryAfter: 1000,
    })
    expect(fetched).toEqual([])

    const later = createLinkCardService({ store, fetchRecord, now: () => 1000 })
    expect(await later.lookup(url, { fetch: true })).toMatchObject({
      status: "ok",
      source: "fetched",
    })
    expect(fetched).toEqual([url])
  })

  it("同じ URL への同時のリクエストは 1 回の取得にまとめる", async () => {
    const { store, puts } = memoryStore()
    let calls = 0
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const service = createLinkCardService({
      store,
      fetchRecord: async (url) => {
        calls++
        await gate
        return ok(url)
      },
    })
    const pending = [
      service.lookup("https://example.com/same", { fetch: true }),
      service.lookup("https://example.com/same", { fetch: true }),
      service.refresh("https://example.com/same"),
    ]
    await new Promise((resolve) => setTimeout(resolve, 10))
    release()
    const results = await Promise.all(pending)
    expect(calls).toBe(1)
    expect(puts).toEqual(["https://example.com/same"])
    expect(results.every((r) => r.status === "ok")).toBe(true)
  })

  it("http(s) でない URL は InvalidUrlError", async () => {
    const service = createLinkCardService({ store: memoryStore().store })
    await expect(
      service.lookup("javascript:alert(1)", { fetch: true }),
    ).rejects.toBeInstanceOf(InvalidUrlError)
    await expect(
      service.lookup(undefined, { fetch: true }),
    ).rejects.toBeInstanceOf(InvalidUrlError)
    await expect(
      service.refresh("https://x.com/sh1ma/status/1"),
    ).rejects.toBeInstanceOf(InvalidUrlError)
  })
})

describe("createLinkCardService().ensure (保存時・一括取得)", () => {
  it("まだ取っていない URL だけを取る (保存済み・JSON・X・再試行待ちは除く)", async () => {
    const { store } = memoryStore({
      "https://example.com/stored": ok("https://example.com/stored"),
      "https://example.com/wait": failed("https://example.com/wait", 5000),
      "https://example.com/retry": failed("https://example.com/retry", 10),
    })
    const fetched: string[] = []
    const service = createLinkCardService({
      store,
      now: () => 100,
      fetchRecord: async (url) => {
        fetched.push(url)
        return url.endsWith("/bad") ? failed(url, 200) : ok(url)
      },
    })
    const result = await service.ensure([
      "https://example.com/stored",
      "https://example.com/wait",
      "https://example.com/retry",
      LEGACY,
      "https://x.com/sh1ma/status/1",
      "https://example.com/new",
      "https://example.com/new",
      "https://example.com/bad",
    ])
    expect(fetched.sort()).toEqual([
      "https://example.com/bad",
      "https://example.com/new",
      "https://example.com/retry",
    ])
    expect(result).toEqual({ fetched: 2, failed: 1, pending: 0 })
  })

  it("1 回に取る数を制限し、残りの数を返す", async () => {
    const service = createLinkCardService({
      store: memoryStore().store,
      fetchRecord: async (url) => ok(url),
    })
    const urls = Array.from({ length: 5 }, (_, i) => `https://example.com/${i}`)
    expect(await service.ensure(urls, { max: 3 })).toEqual({
      fetched: 3,
      failed: 0,
      pending: 2,
    })
  })
})

describe("mapLimit", () => {
  it("同時に動かす数を制限し、順番どおりに返す", async () => {
    let running = 0
    let peak = 0
    const result = await mapLimit([1, 2, 3, 4, 5, 6], 2, async (n) => {
      running++
      peak = Math.max(peak, running)
      await new Promise((resolve) => setTimeout(resolve, 5))
      running--
      return n * 10
    })
    expect(result).toEqual([10, 20, 30, 40, 50, 60])
    expect(peak).toBe(2)
  })
})

function memoryKv(): RateStore {
  const rows = new Map<string, { value: unknown; revision: string }>()
  let revision = 0
  return {
    getVersioned: async <T>(key: string) =>
      (rows.get(key) as { value: T; revision: string } | undefined) ?? null,
    compareAndSet: async (key, expected, value) => {
      const current = rows.get(key)
      if ((current?.revision ?? null) !== expected) return { applied: false }
      rows.set(key, { value, revision: String(++revision) })
      return { applied: true }
    },
  }
}

describe("consumeRateLimit", () => {
  it("ユーザーごとに 1 分 30 回まで。次の 1 分で戻る", async () => {
    const kv = memoryKv()
    const minute = 60_000 * 1000
    for (let i = 0; i < 30; i++) {
      expect(await consumeRateLimit(kv, "u1", minute + i)).toBe(true)
    }
    expect(await consumeRateLimit(kv, "u1", minute + 59_999)).toBe(false)
    expect(await consumeRateLimit(kv, "u2", minute)).toBe(true)
    expect(await consumeRateLimit(kv, "u1", minute + 60_000)).toBe(true)
  })

  it("同時に数えても取りこぼさない", async () => {
    const kv = memoryKv()
    const results = await Promise.all(
      Array.from({ length: 5 }, () => consumeRateLimit(kv, "u", 0, 3)),
    )
    expect(results.filter(Boolean).length).toBeLessThanOrEqual(3)
  })
})
