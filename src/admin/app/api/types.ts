// EmDash の API が返す形のうち、この管理画面で使う部分。
// 一次ソースは emdash/src/api/schemas/*.ts (zod スキーマ)。

/** 記事 (emdash/src/api/schemas/content.ts の contentItemSchema) */
export type ContentItem = {
  id: string
  type: string
  slug: string | null
  /** draft / published / scheduled (EmDash はほかの値も持てる) */
  status: string
  data: Record<string, unknown>
  /** GET で下書きリビジョンを重ねたときだけ付く公開中の値 */
  liveData?: Record<string, unknown>
  authorId: string | null
  createdAt: string
  updatedAt: string
  publishedAt: string | null
  scheduledAt: string | null
  liveRevisionId: string | null
  draftRevisionId: string | null
  version: number
  locale: string | null
  translationGroup: string | null
}

/** GET / PUT / POST の応答 (contentResponseSchema) */
export type ContentResponse = { item: ContentItem; _rev?: string }

export type ContentListResponse = {
  items: ContentItem[]
  nextCursor?: string
  total?: number
}

/** フィールド定義 (GET /schema/collections/{slug}?includeFields=true の fields) */
export type SchemaField = {
  slug: string
  label: string
  type: string
  required?: boolean
  widget?: string | null
  options?: Record<string, unknown> | null
  defaultValue?: unknown
  sortOrder?: number
  translatable?: boolean
}

export type CollectionSchema = {
  slug: string
  label: string
  titleField?: string | null
  urlPattern?: string | null
  supports?: string[]
  editLocking?: boolean
  fields: SchemaField[]
}

/** リビジョン (emdash/src/database/repositories/revision.ts の Revision + author) */
export type Revision = {
  id: string
  collection: string
  entryId: string
  data: Record<string, unknown>
  authorId: string | null
  createdAt: string
  author?: { id: string; name: string | null } | null
}

/** 編集ロック (emdash/src/api/schemas/entry-lock.ts) */
export type LockHolder = {
  userId: string
  userName: string | null
  acquiredAt: string
  expiresAt: string
}
export type LockStatus = {
  enabled: boolean
  holder: LockHolder | null
  heldByCaller: boolean
}

export type Translation = {
  id: string
  locale: string | null
  slug: string | null
  status: string
  updatedAt: string
}

/** メディア (emdash/src/api/schemas/media.ts の mediaListReadItemSchema) */
export type MediaItem = {
  id: string
  filename: string
  mimeType: string
  size: number | null
  width: number | null
  height: number | null
  alt: string | null
  caption: string | null
  storageKey: string
  status: string
  createdAt: string
  authorId: string | null
  url: string
}

export type MediaListResponse = {
  items: MediaItem[]
  nextCursor?: string
  totalCount?: number
}

export type Me = {
  id: string
  name: string | null
  email: string
  role: number
  roleLabel: string
}
