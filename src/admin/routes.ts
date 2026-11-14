// 自前の管理画面が受け持つパス。Astro integration (サーバー) と
// クライアントのルーター (app/router.ts) の両方から使う。

export const ADMIN_BASE = "/_emdash/admin"

/**
 * injectRoute する pattern。ここに無いパス (login, device, setup, settings,
 * content/... など) は EmDash の catch-all (`/_emdash/admin/[...path]`) が返す。
 * EmDash の SPA と同じパスを持つのは `/` (ダッシュボード) と `/media` だけで、
 * これは意図して置き換えている。
 */
export const ADMIN_ROUTE_PATTERNS = [
  ADMIN_BASE,
  `${ADMIN_BASE}/posts/[...path]`,
  `${ADMIN_BASE}/media`,
  `${ADMIN_BASE}/tags`,
] as const

/**
 * `?classic=1` のときに rewrite する先。EmDash の catch-all にだけ当たるパスなら何でもよい
 * (EmDash の SPA はブラウザの URL を見て画面を決めるので、元の URL の画面が出る)。
 */
export const CLASSIC_SHELL_PATH = `${ADMIN_BASE}/classic-shell`

export const CLASSIC_PARAM = "classic"

/** 元の EmDash 管理画面のパス */
export const classicUrl = {
  dashboard: `${ADMIN_BASE}/?${CLASSIC_PARAM}=1`,
  media: `${ADMIN_BASE}/media?${CLASSIC_PARAM}=1`,
  settings: `${ADMIN_BASE}/settings`,
  post: (id: string) => `${ADMIN_BASE}/content/posts/${encodeURIComponent(id)}`,
  posts: `${ADMIN_BASE}/content/posts`,
}

export const LOGIN_PATH = `${ADMIN_BASE}/login`
