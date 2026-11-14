import { ApiError, NetworkError } from "../api/client"
import type { LockHolder } from "../api/types"

// 自動保存。入力が止まって delay ミリ秒たったら保存する。
// - 保存中に入力があれば、終わってからもう一度保存する (同時に 2 本は送らない)
// - 送るたびに直前の応答の _rev を付ける。409 CONFLICT は「別の場所で変更された」として
//   止まり、resolveConflict で上書き / 再読込を選ぶまで保存しない
// - 通信できない・失敗したときは stash (localStorage) に残し、オンラインに戻ったら送り直す
// React に依存しないので autosave.test.ts で単体テストする。

export type SaveState =
  | { kind: "idle" }
  | { kind: "dirty" }
  /** まだ送れない (新規で slug が決まっていないなど)。端末には保存済み */
  | { kind: "waiting"; message: string }
  | { kind: "saving" }
  | { kind: "saved"; at: number }
  | { kind: "offline" }
  | { kind: "conflict"; message: string }
  | { kind: "locked"; holder: LockHolder | null; message: string }
  | { kind: "error"; message: string }

export type SaveResult = { rev: string | undefined }

export type SaveOptions = {
  rev: string | undefined
  /** ⌘S などで明示的に保存した (リビジョンとして残す) */
  explicit: boolean
  /** 他の人の編集ロックを無視する */
  overrideLock: boolean
}

export type AutosaveOptions<T> = {
  delay?: number
  /** オフラインのときに送り直しを試す間隔 */
  retryDelay?: number
  initialRev: string | undefined
  save: (snapshot: T, options: SaveOptions) => Promise<SaveResult>
  stash?: { write: (snapshot: T) => void; clear: () => void }
  onState?: (state: SaveState) => void
  isOnline?: () => boolean
  /** 送れないときはその理由を返す (送れるなら null) */
  blockedReason?: (snapshot: T) => string | null
}

export class Autosave<T> {
  private readonly delay: number
  private readonly retryDelay: number
  private readonly options: AutosaveOptions<T>
  private timer: ReturnType<typeof setTimeout> | null = null
  private pending: T | null = null
  private inFlight: Promise<void> | null = null
  private explicitRequested = false
  private overrideLock = false
  private disposed = false
  rev: string | undefined
  state: SaveState = { kind: "idle" }

  constructor(options: AutosaveOptions<T>) {
    this.options = options
    this.delay = options.delay ?? 1500
    this.retryDelay = options.retryDelay ?? 10_000
    this.rev = options.initialRev
  }

  get hasUnsaved() {
    return this.pending !== null || this.state.kind === "saving"
  }

  /** 値が変わった。stash にはすぐ書き、サーバーへは delay 後に送る */
  change(snapshot: T) {
    if (this.disposed) return
    this.pending = snapshot
    this.options.stash?.write(snapshot)
    if (this.state.kind === "conflict" || this.state.kind === "locked") return
    this.setState({ kind: "dirty" })
    this.schedule(this.delay)
  }

  /** すぐ保存する (⌘S)。保存するものが無ければ何もしない */
  flush(explicit = true): Promise<void> {
    if (explicit) this.explicitRequested = true
    if (this.state.kind === "conflict" || this.state.kind === "locked") {
      return Promise.resolve()
    }
    this.clearTimer()
    return this.run()
  }

  /**
   * 衝突の解決。overwrite: 最新の _rev で上書き保存する。
   * reload: 未保存の値を捨てる (呼び出し側がサーバーの値を読み直す)。
   */
  async resolveConflict(
    choice: "overwrite" | "reload",
    latestRev?: string | undefined,
  ) {
    if (choice === "reload") {
      this.pending = null
      this.options.stash?.clear()
      if (latestRev !== undefined) this.rev = latestRev
      this.setState({ kind: "idle" })
      return
    }
    if (latestRev !== undefined) this.rev = latestRev
    this.setState({ kind: "dirty" })
    await this.flush(true)
  }

  /** 編集ロックを無視して保存し直す */
  async overrideLockAndSave() {
    this.overrideLock = true
    this.setState({ kind: "dirty" })
    await this.flush(true)
  }

  /** サーバー側で _rev が進んだ (公開・予約など、自動保存以外の操作の応答) */
  setRev(rev: string | undefined) {
    this.rev = rev
  }

  /** オンラインに戻ったとき */
  retry() {
    if (this.pending !== null && this.state.kind === "offline") {
      this.schedule(0)
    }
  }

  dispose() {
    this.disposed = true
    this.clearTimer()
  }

  private schedule(ms: number) {
    this.clearTimer()
    this.timer = setTimeout(() => {
      this.timer = null
      void this.run()
    }, ms)
  }

  private clearTimer() {
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }

  private setState(state: SaveState) {
    this.state = state
    this.options.onState?.(state)
  }

  private run(): Promise<void> {
    if (this.inFlight) {
      // 保存中。終わったら残りを送る
      return this.inFlight.then(() =>
        this.pending !== null ? this.run() : undefined,
      )
    }
    if (this.pending === null) return Promise.resolve()
    this.inFlight = this.saveOnce().finally(() => {
      this.inFlight = null
    })
    return this.inFlight.then(() => {
      if (
        this.pending !== null &&
        this.state.kind === "dirty" &&
        this.timer === null
      ) {
        return this.run()
      }
    })
  }

  private async saveOnce() {
    const snapshot = this.pending as T
    const blocked = this.options.blockedReason?.(snapshot) ?? null
    if (blocked) {
      this.setState({ kind: "waiting", message: blocked })
      return
    }
    if (this.options.isOnline && !this.options.isOnline()) {
      this.setState({ kind: "offline" })
      this.schedule(this.retryDelay)
      return
    }
    const explicit = this.explicitRequested
    this.explicitRequested = false
    this.setState({ kind: "saving" })
    try {
      const result = await this.options.save(snapshot, {
        rev: this.rev,
        explicit,
        overrideLock: this.overrideLock,
      })
      this.rev = result.rev
      if (this.pending === snapshot) {
        this.pending = null
        this.options.stash?.clear()
        this.setState({ kind: "saved", at: Date.now() })
      } else {
        // 保存中に入力があった
        this.setState({ kind: "dirty" })
      }
    } catch (error) {
      if (explicit) this.explicitRequested = true
      if (error instanceof ApiError && error.isLocked) {
        const holder = error.details as LockHolder | undefined
        this.setState({
          kind: "locked",
          holder: holder?.userId ? holder : null,
          message: error.message,
        })
      } else if (error instanceof ApiError && error.isConflict) {
        this.setState({ kind: "conflict", message: error.message })
      } else if (error instanceof NetworkError) {
        this.setState({ kind: "offline" })
        this.schedule(this.retryDelay)
      } else {
        this.setState({
          kind: "error",
          message: error instanceof Error ? error.message : String(error),
        })
      }
    }
  }
}
