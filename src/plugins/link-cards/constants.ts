// リンクカードのプラグインの定数。サーバー (plugin.ts)・公開ページ (src/lib/ogp-store.ts)・
// 管理画面 (src/admin/app/api/client.ts) から使うので、ここには依存を持たせない。

export const PLUGIN_ID = "link-cards"
export const PLUGIN_VERSION = "1.0.0"

/** プラグインのストレージのコレクション名。キーは normalizeOgpUrl した URL、値は OgpRecord */
export const OGP_COLLECTION = "ogp"

/** プラグインのルート。/_emdash/api/plugins/link-cards/<名前> になる */
export const ROUTES = {
  /** GET ?url= 保存済みなら返す。無ければ取得して保存して返す */
  ogp: "ogp",
  /** POST { url } 取り直す */
  refresh: "ogp/refresh",
  /** POST { cursor? } 全記事のリンクカードのうち、まだ取っていないものを取る (数記事ずつ) */
  backfill: "ogp/backfill",
} as const

/** 1 ユーザーが 1 分間に外へ取りに行かせられる回数 */
export const RATE_LIMIT_PER_MINUTE = 30
/** 保存 1 回で取りに行く URL の上限 (残りは次の保存か一括取得で取る) */
export const MAX_FETCHES_PER_SAVE = 20
/** 同時に取りに行く数 */
export const FETCH_CONCURRENCY = 4
/** 一括取得で 1 回に見る記事の数 */
export const BACKFILL_POSTS_PER_CALL = 5

export type PluginOptions = Record<string, never>
