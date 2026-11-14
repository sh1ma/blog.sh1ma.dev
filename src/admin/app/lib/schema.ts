import { WIDGET_ID } from "../../../plugins/markdown-editor/constants"
import type { CollectionSchema, SchemaField } from "../api/types"

// スキーマ API のフィールド定義から、編集画面のどこに何を出すかを決める。
// 項目はハードコードせず、スキーマが取れないとき (schema:read が無いロールなど) だけ
// DEFAULT_FIELDS (seed/seed.json の posts と同じ) を使う。

export type PropertyKind =
  | "date"
  | "tags"
  | "text"
  | "longText"
  | "number"
  | "boolean"
  | "url"
  | "select"

export type PropertyDef = {
  slug: string
  label: string
  kind: PropertyKind
  required: boolean
  /** 「さらに表示」の中に入れる */
  advanced: boolean
  /** select / multiSelect の選択肢 (無ければ自由入力) */
  choices: string[]
  defaultValue: unknown
}

export type EditorLayout = {
  /** 大きなタイトルに出すフィールド */
  titleField: string
  /** 全画面エディタに出す本文 (Markdown) のフィールド */
  bodyField: string
  /** カバーに出すフィールド (URL)。無ければ null */
  coverField: string | null
  /** 公開日として扱うフィールド。無ければ null */
  dateField: string | null
  /** タグとして扱うフィールド。無ければ null */
  tagsField: string | null
  properties: PropertyDef[]
  required: string[]
}

export const DEFAULT_FIELDS: SchemaField[] = [
  { slug: "title", label: "Title", type: "string", required: true },
  { slug: "description", label: "Description", type: "text" },
  { slug: "thumbnail", label: "Thumbnail URL", type: "url" },
  {
    slug: "published_date",
    label: "Published date",
    type: "string",
    required: true,
  },
  {
    slug: "priority",
    label: "Sort priority",
    type: "integer",
    defaultValue: 0,
  },
  { slug: "tags", label: "Tags", type: "multiSelect" },
  {
    slug: "markdown",
    label: "Markdown body",
    type: "text",
    required: true,
    widget: WIDGET_ID,
  },
]

/** 日本語の表示名。スキーマの label は英語なので、知っている項目だけ置き換える */
const JAPANESE_LABELS: Record<string, string> = {
  title: "タイトル",
  description: "説明",
  thumbnail: "カバー",
  published_date: "公開日",
  priority: "優先度",
  tags: "タグ",
  markdown: "本文",
}

/** 本文の下に常に出す項目。ほかは「さらに表示」の中 */
const PRIMARY = new Set(["published_date", "tags", "description"])

function choicesOf(field: SchemaField): string[] {
  const options = field.options as { choices?: unknown; options?: unknown }
  const list = options?.choices ?? options?.options
  if (!Array.isArray(list)) return []
  return list
    .map((choice) =>
      typeof choice === "string"
        ? choice
        : typeof choice === "object" && choice && "value" in choice
          ? String((choice as { value: unknown }).value)
          : null,
    )
    .filter((choice): choice is string => choice !== null)
}

function kindOf(
  field: SchemaField,
  layout: Partial<EditorLayout>,
): PropertyKind {
  if (field.slug === layout.dateField) return "date"
  switch (field.type) {
    case "multiSelect":
      return "tags"
    case "select":
      return "select"
    case "text":
      return "longText"
    case "integer":
    case "number":
      return "number"
    case "boolean":
      return "boolean"
    case "url":
      return "url"
    case "date":
    case "datetime":
      return "date"
    default:
      return "text"
  }
}

export function buildLayout(
  schema: Pick<CollectionSchema, "fields" | "titleField"> | null,
): EditorLayout {
  const fields = [...(schema?.fields?.length ? schema.fields : DEFAULT_FIELDS)]
  fields.sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
  const bySlug = new Map(fields.map((field) => [field.slug, field]))

  const titleField =
    (schema?.titleField && bySlug.has(schema.titleField)
      ? schema.titleField
      : null) ??
    fields.find((field) => field.type === "string")?.slug ??
    "title"
  const bodyField =
    fields.find((field) => field.widget === WIDGET_ID)?.slug ??
    (bySlug.has("markdown") ? "markdown" : null) ??
    fields.find((field) => field.type === "text" && field.required)?.slug ??
    "markdown"
  const coverField =
    fields.find(
      (field) =>
        field.type === "url" && /thumbnail|cover|image/i.test(field.slug),
    )?.slug ?? null
  const dateField =
    fields.find((field) => field.slug === "published_date")?.slug ??
    fields.find((field) => field.type === "date")?.slug ??
    null
  const tagsField =
    fields.find(
      (field) => field.slug === "tags" && field.type === "multiSelect",
    )?.slug ??
    fields.find((field) => field.type === "multiSelect")?.slug ??
    null

  const partial = { dateField }
  const special = new Set([titleField, bodyField, coverField])
  const properties: PropertyDef[] = fields
    .filter((field) => !special.has(field.slug))
    .map((field) => ({
      slug: field.slug,
      label: JAPANESE_LABELS[field.slug] ?? field.label,
      kind: kindOf(field, partial),
      required: field.required === true,
      advanced: !PRIMARY.has(field.slug) && !field.required,
      choices: choicesOf(field),
      defaultValue: field.defaultValue,
    }))

  return {
    titleField,
    bodyField,
    coverField,
    dateField,
    tagsField,
    properties,
    required: fields
      .filter((field) => field.required)
      .map((field) => field.slug),
  }
}

/** 新規記事の data の初期値 */
export function initialData(
  layout: EditorLayout,
  today: string,
): Record<string, unknown> {
  const data: Record<string, unknown> = {
    [layout.titleField]: "",
    [layout.bodyField]: "",
  }
  for (const property of layout.properties) {
    if (property.slug === layout.dateField) data[property.slug] = today
    else if (property.kind === "tags") data[property.slug] = []
    else if (property.defaultValue !== undefined)
      data[property.slug] = property.defaultValue
  }
  return data
}

/** 必須項目のうち空のもの (表示名) */
export function missingRequired(
  layout: EditorLayout,
  data: Record<string, unknown>,
): string[] {
  return layout.required
    .filter((slug) => {
      const value = data[slug]
      return (
        value === undefined ||
        value === null ||
        (typeof value === "string" && value.trim() === "") ||
        (Array.isArray(value) && value.length === 0)
      )
    })
    .map((slug) => JAPANESE_LABELS[slug] ?? slug)
}
