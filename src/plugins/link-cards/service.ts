import {
  fetchOgpRecord,
  legacyOgp,
  normalizeOgpUrl,
  type OgpData,
  type OgpRecord,
  shouldFetch,
} from "../../../lib/ogp-fetcher"
import { isTweetUrl } from "../../../lib/standalone-url"
import {
  FETCH_CONCURRENCY,
  MAX_FETCHES_PER_SAVE,
  RATE_LIMIT_PER_MINUTE,
} from "./constants"

// リンクカードの OGP の保存・取得の中身。EmDash に依存しない形にして単体テストする
// (plugin.ts が ctx.storage / ctx.kv を渡す)。

/** ctx.storage.ogp のうち使うもの (EmDash の StorageCollection) */
export type RecordStore = {
  get(id: string): Promise<OgpRecord | null>
  getMany(ids: string[]): Promise<Map<string, OgpRecord>>
  put(id: string, data: OgpRecord): Promise<void>
}

/** ctx.kv のうち使うもの (EmDash の KVAccess) */
export type RateStore = {
  getVersioned<T>(key: string): Promise<{ value: T; revision: string } | null>
  compareAndSet(
    key: string,
    expectedRevision: string | null,
    value: unknown,
  ): Promise<{ applied: boolean }>
}

export type OgpLookup = {
  /** 正規化した URL (ストレージのキー) */
  url: string
  status: "ok" | "failed" | "missing"
  /** stored: ストレージ / legacy: src/data/ogp-cache.json / fetched: いま取った */
  source: "stored" | "legacy" | "fetched" | "none"
  data: OgpData | null
  fetchedAt: number | null
  error?: string
  retryAfter?: number
}

export class InvalidUrlError extends Error {}
export class RateLimitedError extends Error {}

/** 同じ isolate で同じ URL を同時に取りに行かない */
const inflight = new Map<string, Promise<OgpRecord>>()

export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const index = next++
      results[index] = await fn(items[index])
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  )
  return results
}

function fromRecord(record: OgpRecord, source: OgpLookup["source"]): OgpLookup {
  return {
    url: record.url,
    status: record.data ? "ok" : "failed",
    source,
    data: record.data,
    fetchedAt: record.fetchedAt,
    ...(record.error ? { error: record.error } : {}),
    ...(record.retryAfter ? { retryAfter: record.retryAfter } : {}),
  }
}

export function normalizeOrThrow(raw: unknown): string {
  const key = typeof raw === "string" ? normalizeOgpUrl(raw) : null
  if (!key) throw new InvalidUrlError("http(s) の URL を指定してください")
  return key
}

export type ServiceDeps = {
  store: RecordStore
  fetchRecord?: (url: string) => Promise<OgpRecord>
  now?: () => number
}

export function createLinkCardService({
  store,
  fetchRecord = (url) => fetchOgpRecord(url),
  now = Date.now,
}: ServiceDeps) {
  function fetchAndStore(key: string): Promise<OgpRecord> {
    let pending = inflight.get(key)
    if (!pending) {
      pending = fetchRecord(key)
        .then(async (record) => {
          await store.put(key, { ...record, url: key })
          return { ...record, url: key }
        })
        .finally(() => inflight.delete(key))
      inflight.set(key, pending)
    }
    return pending
  }

  return {
    /**
     * 保存済み (ストレージ → JSON) を返す。無ければ (失敗して再試行を待っている間は除く)
     * fetch: true のときだけ取りに行って保存する。beforeFetch はレート制限用。
     */
    async lookup(
      rawUrl: unknown,
      options: { fetch: boolean; beforeFetch?: () => Promise<void> },
    ): Promise<OgpLookup> {
      const key = normalizeOrThrow(rawUrl)
      const stored = await store.get(key)
      if (stored?.data) return fromRecord(stored, "stored")
      const legacy = legacyOgp(key)
      if (legacy) {
        return {
          url: key,
          status: "ok",
          source: "legacy",
          data: legacy,
          fetchedAt: null,
        }
      }
      if (!options.fetch || isTweetUrl(key) || !shouldFetch(stored, now())) {
        return stored
          ? fromRecord(stored, "stored")
          : {
              url: key,
              status: "missing",
              source: "none",
              data: null,
              fetchedAt: null,
            }
      }
      await options.beforeFetch?.()
      return fromRecord(await fetchAndStore(key), "fetched")
    },

    /** 保存済みかどうかに関わらず取り直す (管理画面の「再取得」) */
    async refresh(
      rawUrl: unknown,
      options: { beforeFetch?: () => Promise<void> } = {},
    ): Promise<OgpLookup> {
      const key = normalizeOrThrow(rawUrl)
      if (isTweetUrl(key)) {
        throw new InvalidUrlError("X の投稿は OGP を取りません")
      }
      await options.beforeFetch?.()
      return fromRecord(await fetchAndStore(key), "fetched")
    },

    /**
     * 記事のリンクカードの URL のうち、まだ取っていないもの (ストレージにも JSON にも無い・
     * 失敗して再試行してよい時刻を過ぎた) を取って保存する。保存時と一括取得で使う。
     */
    async ensure(
      urls: string[],
      options: { max?: number } = {},
    ): Promise<{ fetched: number; failed: number; pending: number }> {
      const keys = [
        ...new Set(
          urls
            .filter((url) => !isTweetUrl(url))
            .map(normalizeOgpUrl)
            .filter((key): key is string => !!key),
        ),
      ]
      if (keys.length === 0) return { fetched: 0, failed: 0, pending: 0 }
      const stored = await store.getMany(keys)
      const at = now()
      const todo = keys.filter((key) => {
        const record = stored.get(key)
        return !record?.data && !legacyOgp(key) && shouldFetch(record, at)
      })
      const max = options.max ?? MAX_FETCHES_PER_SAVE
      const records = await mapLimit(
        todo.slice(0, max),
        FETCH_CONCURRENCY,
        (key) =>
          fetchAndStore(key).catch(
            (error): OgpRecord => ({
              url: key,
              data: null,
              fetchedAt: at,
              error: `保存できませんでした: ${String(error)}`,
            }),
          ),
      )
      const failed = records.filter((record) => !record.data).length
      return {
        fetched: records.length - failed,
        failed,
        pending: Math.max(todo.length - max, 0),
      }
    },
  }
}

export type LinkCardService = ReturnType<typeof createLinkCardService>

type RateWindow = { window: number; count: number }

/**
 * ユーザーごとの 1 分間の回数制限 (固定窓)。数えたら true、上限なら false。
 * isolate をまたいで効くよう ctx.kv に compareAndSet で書く。
 */
export async function consumeRateLimit(
  kv: RateStore,
  userId: string,
  now: number,
  limit = RATE_LIMIT_PER_MINUTE,
): Promise<boolean> {
  const key = `rate:${userId}`
  const window = Math.floor(now / 60_000)
  for (let attempt = 0; attempt < 5; attempt++) {
    const current = await kv.getVersioned<RateWindow>(key)
    const value = current?.value
    let next: RateWindow
    if (!value || value.window !== window) next = { window, count: 1 }
    else if (value.count >= limit) return false
    else next = { window, count: value.count + 1 }
    const result = await kv.compareAndSet(key, current?.revision ?? null, next)
    if (result.applied) return true
  }
  return false
}
