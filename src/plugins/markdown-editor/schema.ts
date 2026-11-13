import { type AnyExtension, Extension, getSchema, Node } from "@tiptap/core"
import Code from "@tiptap/extension-code"
import Image from "@tiptap/extension-image"
import { TaskItem, TaskList } from "@tiptap/extension-list"
import { TableKit } from "@tiptap/extension-table"
import StarterKit from "@tiptap/starter-kit"

// エディタの文書構造 (ProseMirror スキーマ)。React に依存しないので、
// 管理画面のエディタと Node のテスト (markdown.test.ts) の両方から使う。
// 見た目 (node view) は admin.tsx で extend して足す。

export const ALERT_TYPES = [
  "note",
  "tip",
  "important",
  "warning",
  "caution",
] as const
export type AlertType = (typeof ALERT_TYPES)[number]

/** 解析しても往復が保証できないブロック。元の Markdown をそのまま持つ */
export const RawMarkdown = Node.create({
  name: "rawMarkdown",
  group: "block",
  atom: true,
  selectable: true,
  draggable: false,
  addAttributes() {
    return { source: { default: "" } }
  },
  parseHTML() {
    return [{ tag: "div[data-raw-markdown]" }]
  },
  renderHTML({ node }) {
    return ["div", { "data-raw-markdown": "" }, ["pre", node.attrs.source]]
  },
})

/** GitHub アラート (> [!NOTE] など) */
export const Alert = Node.create({
  name: "alert",
  group: "block",
  content: "block+",
  defining: true,
  addAttributes() {
    return { type: { default: "note" } }
  },
  parseHTML() {
    return [{ tag: "div[data-alert]" }]
  },
  renderHTML({ node }) {
    return [
      "div",
      {
        "data-alert": node.attrs.type,
        class: `md-alert md-alert-${node.attrs.type}`,
      },
      0,
    ]
  },
})

export const MathBlock = Node.create({
  name: "mathBlock",
  group: "block",
  atom: true,
  addAttributes() {
    return { latex: { default: "" } }
  },
  parseHTML() {
    return [{ tag: "div[data-math-block]" }]
  },
  renderHTML({ node }) {
    return ["div", { "data-math-block": "" }, node.attrs.latex]
  },
})

export const MathInline = Node.create({
  name: "mathInline",
  group: "inline",
  inline: true,
  atom: true,
  addAttributes() {
    return { latex: { default: "" } }
  },
  parseHTML() {
    return [{ tag: "span[data-math-inline]" }]
  },
  renderHTML({ node }) {
    return ["span", { "data-math-inline": "" }, node.attrs.latex]
  },
})

export const FootnoteReference = Node.create({
  name: "footnoteReference",
  group: "inline",
  inline: true,
  atom: true,
  addAttributes() {
    return { label: { default: "" } }
  },
  parseHTML() {
    return [{ tag: "sup[data-footnote-reference]" }]
  },
  renderHTML({ node }) {
    return ["sup", { "data-footnote-reference": "" }, `[^${node.attrs.label}]`]
  },
})

export const FootnoteDefinition = Node.create({
  name: "footnoteDefinition",
  group: "block",
  content: "block+",
  defining: true,
  addAttributes() {
    return { label: { default: "" } }
  },
  parseHTML() {
    return [{ tag: "div[data-footnote-definition]" }]
  },
  renderHTML({ node }) {
    return [
      "div",
      { "data-footnote-definition": node.attrs.label, class: "md-footnote" },
      0,
    ]
  },
})

const notRendered = (fallback: unknown) => ({
  default: fallback,
  rendered: false,
  keepOnSplit: false,
})

/**
 * Markdown の書き方を覚えておくための属性。表示には使わない。
 * - spread: 箇条書きの項目間に空行があるか (HTML の <p> の有無が変わる)
 * - meta: コードブロックの言語名の後ろ (title="..." など)
 * - style: 改行の書き方 (行末スペース 2 つ / バックスラッシュ)
 * - source: リンクの書き方 (URL そのまま / <URL> / [text](url))
 */
const MarkdownAttributes = Extension.create({
  name: "markdownAttributes",
  addGlobalAttributes() {
    return [
      {
        types: ["bulletList", "orderedList", "taskList"],
        attributes: { spread: notRendered(false) },
      },
      {
        types: ["listItem", "taskItem"],
        attributes: { spread: notRendered(false) },
      },
      { types: ["codeBlock"], attributes: { meta: notRendered(null) } },
      { types: ["hardBreak"], attributes: { style: notRendered(null) } },
      { types: ["link"], attributes: { source: notRendered(null) } },
    ]
  },
})

export function createExtensions(): AnyExtension[] {
  return [
    StarterKit.configure({
      code: false,
      underline: false,
      heading: { levels: [1, 2, 3, 4, 5, 6] },
      link: {
        openOnClick: false,
        autolink: true,
        linkOnPaste: true,
        HTMLAttributes: { target: null, rel: null, class: null },
      },
    }),
    // Markdown ではインラインコードをリンクや太字の中に書けるので、他のマークを排除しない
    Code.extend({ excludes: "" }),
    Image.configure({ inline: true, allowBase64: false }),
    TaskList,
    TaskItem.configure({ nested: true }),
    TableKit.configure({ table: { resizable: false } }),
    RawMarkdown,
    Alert,
    MathBlock,
    MathInline,
    FootnoteReference,
    FootnoteDefinition,
    MarkdownAttributes,
  ]
}

export function createSchema() {
  return getSchema(createExtensions())
}
