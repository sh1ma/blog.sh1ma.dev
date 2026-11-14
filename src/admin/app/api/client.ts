// EmDash の API (/_emdash/api/**) の薄いラッパー。
// リクエストの形は EmDash 本体 (emdash/src/astro/routes/api/**) と、
// 純正の管理画面のクライアント (@emdash-cms/admin の src/lib/api/*.ts) に合わせている。
// fetch を差し替えられるようにしてあるのは単体テスト (client.test.ts) のため。

import type {
  CollectionSchema,
  ContentItem,
  ContentListResponse,
  ContentResponse,
  LockStatus,
  MediaItem,
  MediaListResponse,
  Revision,
  Translation,
} from "./types"

export const API_BASE = "/_emdash/api"
export const COLLECTION = "posts"

type Envelope<T> = {
  success?: boolean
  data?: T
  error?: { code?: string; message?: string; details?: unknown }
}

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly details: unknown

  constructor(
    status: number,
    code: string,
    message: string,
    details?: unknown,
  ) {
    super(message)
    this.name = "ApiError"
    this.status = status
    this.code = code
    this.details = details
  }

  /** _rev が古い (別の場所で変更された) */
  get isConflict() {
    return (
      this.code === "CONFLICT" ||
      (this.status === 409 && this.code !== "ENTRY_LOCKED")
    )
  }

  /** 他の人が編集ロックを持っている */
  get isLocked() {
    return this.code === "ENTRY_LOCKED"
  }
}

/** 通信できなかった (オフラインなど)。サーバーが応答したエラーとは区別する */
export class NetworkError extends Error {
  constructor(cause: unknown) {
    super("サーバーに接続できませんでした")
    this.name = "NetworkError"
    this.cause = cause
  }
}

export type Fetcher = (input: string, init?: RequestInit) => Promise<Response>

export type UpdateInput = {
  data?: Record<string, unknown>
  slug?: string | null
  /** 楽観的排他制御のトークン。GET / PUT の応答の _rev */
  _rev?: string
  /** 直前の自動保存リビジョンを置き換える (純正管理画面の自動保存と同じ) */
  skipRevision?: boolean
  /** 他の人の編集ロックを無視して書く */
  overrideLock?: boolean
}

export type CreateInput = {
  data: Record<string, unknown>
  slug?: string | null
  locale?: string
  /** 対訳元の記事 ID */
  translationOf?: string
}

function query(params: Record<string, string | number | undefined>) {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") search.set(key, String(value))
  }
  const text = search.toString()
  return text ? `?${text}` : ""
}

const enc = encodeURIComponent

export function createApi(
  fetcher: Fetcher = (input, init) => fetch(input, init),
) {
  async function request<T>(
    path: string,
    init: RequestInit & { json?: unknown } = {},
  ): Promise<T> {
    const { json, ...rest } = init
    const headers = new Headers(rest.headers)
    // Cookie セッションでの書き込みには CSRF 対策のヘッダーが要る
    // (emdash/src/astro/middleware/auth.ts の X-EmDash-Request の検査)
    headers.set("X-EmDash-Request", "1")
    if (json !== undefined) headers.set("Content-Type", "application/json")
    let response: Response
    try {
      response = await fetcher(`${API_BASE}${path}`, {
        ...rest,
        headers,
        credentials: "same-origin",
        body: json !== undefined ? JSON.stringify(json) : rest.body,
      })
    } catch (error) {
      throw new NetworkError(error)
    }
    const body = (await response.json().catch(() => ({}))) as Envelope<T>
    if (!response.ok || body.success === false || body.data === undefined) {
      throw new ApiError(
        response.status,
        body.error?.code ?? `HTTP_${response.status}`,
        body.error?.message ?? `リクエストに失敗しました (${response.status})`,
        body.error?.details,
      )
    }
    return body.data
  }

  const content = (id?: string, suffix = "") =>
    `/content/${COLLECTION}${id ? `/${enc(id)}` : ""}${suffix}`

  function listPosts(
    options: {
      locale?: string
      status?: string
      cursor?: string
      limit?: number
      q?: string
    } = {},
  ) {
    return request<ContentListResponse>(
      `${content()}${query({ limit: 100, ...options })}`,
    )
  }

  async function listAllPosts(
    options: { locale?: string; status?: string } = {},
  ) {
    const items: ContentItem[] = []
    let cursor: string | undefined
    do {
      const page = await listPosts({ ...options, cursor })
      items.push(...page.items)
      cursor = page.nextCursor
    } while (cursor)
    return items
  }

  return {
    request,

    // --- 認証 (routes/api/auth/*.ts)
    logout: () => request<unknown>("/auth/logout", { method: "POST" }),

    // --- スキーマ (routes/api/schema/collections/[slug]/index.ts。schema:read が要る)
    getSchema: async () =>
      (
        await request<{ item: CollectionSchema }>(
          `/schema/collections/${COLLECTION}${query({ includeFields: "true" })}`,
        )
      ).item,

    // --- 記事 (routes/api/content/[collection]/*.ts)
    listPosts,

    /** ページ送りしながら全件取る */
    listAllPosts,

    /** 下書きリビジョンがあればそれを重ねた値が返る (emdash-runtime.ts の hydrateDraftData) */
    getPost: (id: string) => request<ContentResponse>(content(id)),

    createPost: (input: CreateInput) =>
      request<ContentResponse>(content(), { method: "POST", json: input }),

    updatePost: (id: string, input: UpdateInput) =>
      request<ContentResponse>(content(id), { method: "PUT", json: input }),

    deletePost: (id: string) =>
      request<unknown>(content(id), { method: "DELETE" }),

    publish: (id: string, input: { _rev?: string } = {}) =>
      request<ContentResponse>(content(id, "/publish"), {
        method: "POST",
        json: input,
      }),

    unpublish: (id: string, input: { _rev?: string } = {}) =>
      request<ContentResponse>(content(id, "/unpublish"), {
        method: "POST",
        json: input,
      }),

    /** scheduledAt は ISO 8601 (Z かオフセット付き)。未来の時刻だけ受け付ける */
    schedule: (
      id: string,
      scheduledAt: string,
      input: { _rev?: string } = {},
    ) =>
      request<ContentResponse>(content(id, "/schedule"), {
        method: "POST",
        json: { scheduledAt, ...input },
      }),

    unschedule: (id: string) =>
      request<ContentResponse>(content(id, "/schedule"), { method: "DELETE" }),

    /** 公開中の記事の未公開の変更 (下書きリビジョン) を捨てる */
    discardDraft: (id: string, input: { _rev?: string } = {}) =>
      request<ContentResponse>(content(id, "/discard-draft"), {
        method: "POST",
        json: input,
      }),

    previewUrl: (id: string) =>
      request<{ url: string; expiresAt: number }>(content(id, "/preview-url"), {
        method: "POST",
        json: { expiresIn: "1h" },
      }),

    translations: (id: string) =>
      request<{ translationGroup?: string; translations: Translation[] }>(
        content(id, "/translations"),
      ),

    revisions: (id: string, limit = 50) =>
      request<{ items: Revision[]; total: number }>(
        `${content(id, "/revisions")}${query({ limit })}`,
      ),

    getRevision: async (revisionId: string) =>
      (await request<{ item: Revision }>(`/revisions/${enc(revisionId)}`)).item,

    /** 選んだ版を「今の下書き」にする (公開には publish が別に要る) */
    restoreRevision: (revisionId: string) =>
      request<ContentResponse>(`/revisions/${enc(revisionId)}/restore`, {
        method: "POST",
        json: {},
      }),

    // --- 編集ロック (routes/api/content/[collection]/[id]/lock.ts)
    acquireLock: (id: string, token: string, takeover = false) =>
      request<LockStatus>(content(id, "/lock"), {
        method: "POST",
        json: { takeover, token },
      }),

    releaseLock: (id: string, token: string, keepalive = false) =>
      request<unknown>(`${content(id, "/lock")}${query({ token })}`, {
        method: "DELETE",
        keepalive,
      }),

    // --- メディア (routes/api/media*.ts)
    listMedia: (
      options: { q?: string; cursor?: string; limit?: number } = {},
    ) =>
      request<MediaListResponse>(`/media${query({ limit: 100, ...options })}`),

    updateMedia: async (
      id: string,
      input: { alt?: string; caption?: string },
    ) =>
      (
        await request<{ item: MediaItem }>(`/media/${enc(id)}`, {
          method: "PUT",
          json: input,
        })
      ).item,

    deleteMedia: (id: string) =>
      request<unknown>(`/media/${enc(id)}`, { method: "DELETE" }),
  }
}

export type Api = ReturnType<typeof createApi>

export const api = createApi()
