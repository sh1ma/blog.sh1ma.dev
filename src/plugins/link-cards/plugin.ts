import {
  type ContentHookEvent,
  definePlugin,
  type PluginContext,
  PluginRouteError,
  type RouteContext,
  type StorageCollection,
} from "emdash"
import { collectLinkCardUrls } from "../../../lib/link-card-urls"
import type { OgpRecord } from "../../../lib/ogp-fetcher"
import {
  BACKFILL_POSTS_PER_CALL,
  OGP_COLLECTION,
  PLUGIN_ID,
  PLUGIN_VERSION,
  type PluginOptions,
  ROUTES,
} from "./constants"
import {
  consumeRateLimit,
  createLinkCardService,
  InvalidUrlError,
  RateLimitedError,
} from "./service"

// リンクカードの OGP を保存するプラグイン (Worker に入る)。
// - content:afterSave … 記事の「URL だけの段落」のうち、まだ取っていない URL の OGP を取って保存する。
//   EmDash は afterSave を after() (Workers では waitUntil) で動かすので保存の応答は遅れない
//   (emdash/src/emdash-runtime.ts の runAfterSaveHooks)。
// - routes … 管理画面のエディタのプレビュー用の取得・取り直し・一括取得。
// 保存先はプラグインのストレージ (_plugin_storage。マイグレーション不要)。

/** 記事の本文のフィールド */
const POSTS = "posts"
const MARKDOWN_FIELD = "markdown"

function service(ctx: PluginContext) {
  const store = ctx.storage[OGP_COLLECTION] as StorageCollection<OgpRecord>
  return createLinkCardService({ store })
}

function markdownOf(content: Record<string, unknown>): string | null {
  const data = content.data
  if (!data || typeof data !== "object") return null
  const markdown = (data as Record<string, unknown>)[MARKDOWN_FIELD]
  return typeof markdown === "string" ? markdown : null
}

async function ogpUrlsOf(markdown: string): Promise<string[]> {
  return (await collectLinkCardUrls(markdown))
    .filter((target) => target.kind === "ogp")
    .map((target) => target.url)
}

/** 外へ取りに行く直前に呼ぶ。ユーザーごとに 1 分 30 回まで */
function rateLimiter(ctx: RouteContext) {
  return async () => {
    const allowed = await consumeRateLimit(
      ctx.kv,
      ctx.user?.id ?? "token",
      Date.now(),
    )
    if (!allowed) {
      throw new RateLimitedError(
        "取得の回数が多すぎます。1 分ほど待ってからやり直してください",
      )
    }
  }
}

async function withErrors<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (error) {
    if (error instanceof InvalidUrlError) {
      throw new PluginRouteError("INVALID_URL", error.message, 400)
    }
    if (error instanceof RateLimitedError) {
      throw new PluginRouteError("RATE_LIMITED", error.message, 429)
    }
    throw error
  }
}

function inputOf(ctx: RouteContext): Record<string, unknown> {
  const input = ctx.input
  return input && typeof input === "object"
    ? (input as Record<string, unknown>)
    : {}
}

export function createPlugin(_options: PluginOptions = {}) {
  return definePlugin({
    id: PLUGIN_ID,
    version: PLUGIN_VERSION,
    // content:afterSave と ctx.content (一括取得) に要る。外への取得は ctx.http ではなく
    // lib/ogp-fetcher.ts が fetch を直接使う (リダイレクトの各ホップの検査・本文の打ち切りを自前で行うため)
    capabilities: ["content:read"],
    storage: {
      // 検索しないので索引は作らない (索引が無ければテーブルの追加も要らない)
      [OGP_COLLECTION]: { indexes: [] },
    },
    hooks: {
      "content:afterSave": {
        // 保存の応答の後で動くので長めに取る (Workers の waitUntil は応答後 30 秒まで)
        timeout: 25_000,
        errorPolicy: "continue",
        handler: async (event: ContentHookEvent, ctx: PluginContext) => {
          if (event.collection !== POSTS) return
          const markdown = markdownOf(event.content)
          if (!markdown) return
          const urls = await ogpUrlsOf(markdown)
          if (urls.length === 0) return
          const result = await service(ctx).ensure(urls)
          if (result.fetched + result.failed > 0) {
            ctx.log.info("link-cards: fetched OGP", {
              id: event.content.id,
              ...result,
            })
          }
        },
      },
    },
    routes: {
      [ROUTES.ogp]: {
        methods: ["GET"],
        // 記事を書ける人 (寄稿者以上)
        permission: "content:create",
        handler: (ctx: RouteContext) =>
          withErrors(() =>
            service(ctx).lookup(inputOf(ctx).url, {
              fetch: true,
              beforeFetch: rateLimiter(ctx),
            }),
          ),
      },
      [ROUTES.refresh]: {
        methods: ["POST"],
        permission: "content:create",
        handler: (ctx: RouteContext) =>
          withErrors(() =>
            service(ctx).refresh(inputOf(ctx).url, {
              beforeFetch: rateLimiter(ctx),
            }),
          ),
      },
      [ROUTES.backfill]: {
        methods: ["POST"],
        // 全記事を読むので、他人の記事も編集できる人 (編集者以上)
        permission: "content:edit_any",
        handler: async (ctx: RouteContext) => {
          const content = ctx.content
          if (!content) {
            throw new PluginRouteError("NOT_AVAILABLE", "記事を読めません", 500)
          }
          const cursor = inputOf(ctx).cursor
          const page = await content.list(POSTS, {
            limit: BACKFILL_POSTS_PER_CALL,
            cursor: typeof cursor === "string" && cursor ? cursor : undefined,
          })
          const urls: string[] = []
          for (const item of page.items) {
            const markdown = markdownOf({ data: item.data })
            if (markdown) urls.push(...(await ogpUrlsOf(markdown)))
          }
          const result = await service(ctx).ensure(urls)
          return {
            posts: page.items.length,
            urls: new Set(urls).size,
            ...result,
            // 取り切れなかった URL があれば同じページをもう一度
            cursor:
              result.pending > 0
                ? (cursor ?? null)
                : page.hasMore
                  ? (page.cursor ?? null)
                  : null,
          }
        },
      },
    },
  })
}
