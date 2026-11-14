import { fileURLToPath } from "node:url"
import type { AstroIntegration } from "astro"
import { ADMIN_ROUTE_PATTERNS } from "./routes"

/**
 * EmDash の管理画面 (/_emdash/admin/[...path] の SPA) のうち、記事を書く画面だけを
 * 自前の画面に差し替える。
 *
 * EmDash は catch-all の `/_emdash/admin/[...path]` を inject している。Astro は
 * ルートを「静的なセグメントが多いほうが先」に並べる (astro/dist/core/routing/priority.js
 * の routeComparator) ので、ここで inject するより具体的な pattern が優先され、
 * それ以外 (ログイン・デバイス承認・設定など) は EmDash のまま残る。
 *
 * 認証は EmDash の middleware が /_emdash/admin 以下すべてにかけるので、
 * ここで追加のものは要らない (未ログインならログインへ redirect 付きで飛ぶ)。
 */
export function notionAdmin(): AstroIntegration {
  return {
    name: "blog-notion-admin",
    hooks: {
      "astro:config:setup": ({ injectRoute }) => {
        const entrypoint = fileURLToPath(
          new URL("./AdminPage.astro", import.meta.url),
        )
        for (const pattern of ADMIN_ROUTE_PATTERNS) {
          injectRoute({ pattern, entrypoint, prerender: false })
        }
      },
    },
  }
}
