import type { JSONContent } from "@tiptap/core"
import type { Schema } from "@tiptap/pm/model"
import type * as Md from "mdast"
import { remark } from "remark"
import remarkGfm from "remark-gfm"
import remarkMath from "remark-math"
import { ALERT_TYPES, createSchema } from "./schema"

// Markdown 文字列 ⇄ エディタの文書 (Tiptap / ProseMirror の JSON)。
//
// 方針:
// - 解析は表示側 (src/lib/render-markdown.ts) と同じ remark + GFM + math で行う。
// - トップレベルのブロックごとに「エディタの文書へ変換 → Markdown に戻す → 解析し直す」
//   を試し、mdast が元と一致しないブロックは rawMarkdown (元の文字列のまま保持) にする。
// - 書き戻すときは、元のブロックと同じ内容のブロックは元の文字列をそのまま使い、
//   変わったブロックだけを Markdown に直列化する。

type Block = Md.RootContent
type Phrasing = Md.PhrasingContent
type Mark = NonNullable<JSONContent["marks"]>[number]

class UnsupportedSyntax extends Error {}

let cachedSchema: Schema | undefined
function schema() {
  cachedSchema ??= createSchema()
  return cachedSchema
}

/** スキーマに通して既定値の補完と構造の検査をした JSON を返す */
function normalizeNode(json: JSONContent): JSONContent {
  const node = schema().nodeFromJSON(json)
  node.check()
  return node.toJSON() as JSONContent
}

const stringifyOptions = {
  bullet: "-",
  bulletOther: "*",
  bulletOrdered: ".",
  emphasis: "*",
  strong: "*",
  rule: "-",
  fence: "`",
  fences: true,
  listItemIndent: "one",
  incrementListMarker: true,
  resourceLink: true,
} as const

export type ListMarkers = {
  bullet: "-" | "*" | "+"
  bulletOrdered: "." | ")"
}

const parser = remark().use(remarkGfm).use(remarkMath)
const stringifiers = new Map<string, ReturnType<typeof createStringifier>>()

function createStringifier(markers: ListMarkers) {
  return remark()
    .use(remarkGfm)
    .use(remarkMath)
    .data("settings", {
      ...stringifyOptions,
      ...markers,
      bulletOther: markers.bullet === "*" ? "-" : "*",
    })
}

function stringifier(markers: ListMarkers) {
  const key = markers.bullet + markers.bulletOrdered
  let processor = stringifiers.get(key)
  if (!processor) {
    processor = createStringifier(markers)
    stringifiers.set(key, processor)
  }
  return processor
}

function parse(markdown: string): Md.Root {
  return parser.parse(markdown)
}

// ---------------------------------------------------------------------------
// mdast → エディタの JSON
// ---------------------------------------------------------------------------

type ParseContext = { source: string }

function slice(ctx: ParseContext, node: Md.Node): string {
  const start = node.position?.start.offset
  const end = node.position?.end.offset
  if (start === undefined || end === undefined) return ""
  return ctx.source.slice(start, end)
}

function text(value: string, marks: Mark[]): JSONContent {
  return marks.length > 0
    ? { type: "text", text: value, marks }
    : { type: "text", text: value }
}

function inlineToJson(
  nodes: Phrasing[],
  ctx: ParseContext,
  marks: Mark[] = [],
): JSONContent[] {
  const result: JSONContent[] = []
  for (const node of nodes) {
    switch (node.type) {
      case "text":
        if (node.value) result.push(text(node.value, marks))
        break
      case "inlineCode":
        result.push(text(node.value, [...marks, { type: "code" }]))
        break
      case "strong":
        result.push(
          ...inlineToJson(node.children, ctx, [...marks, { type: "bold" }]),
        )
        break
      case "emphasis":
        result.push(
          ...inlineToJson(node.children, ctx, [...marks, { type: "italic" }]),
        )
        break
      case "delete":
        result.push(
          ...inlineToJson(node.children, ctx, [...marks, { type: "strike" }]),
        )
        break
      case "link": {
        const raw = slice(ctx, node)
        const source = raw.startsWith("<")
          ? "angle"
          : raw.startsWith("[")
            ? null
            : "literal"
        const link: Mark = {
          type: "link",
          attrs: { href: node.url, title: node.title ?? null, source },
        }
        result.push(...inlineToJson(node.children, ctx, [...marks, link]))
        break
      }
      case "break":
        result.push({
          type: "hardBreak",
          attrs: {
            style: slice(ctx, node).startsWith("\\") ? "backslash" : "spaces",
          },
          ...(marks.length > 0 ? { marks } : {}),
        })
        break
      case "image":
        result.push({
          type: "image",
          attrs: { src: node.url, alt: node.alt ?? null, title: node.title },
          ...(marks.length > 0 ? { marks } : {}),
        })
        break
      case "inlineMath":
        result.push({
          type: "mathInline",
          attrs: { latex: node.value },
          ...(marks.length > 0 ? { marks } : {}),
        })
        break
      case "footnoteReference":
        result.push({
          type: "footnoteReference",
          attrs: { label: node.label ?? node.identifier },
          ...(marks.length > 0 ? { marks } : {}),
        })
        break
      default:
        throw new UnsupportedSyntax(node.type)
    }
  }
  return result
}

function paragraph(children: Phrasing[], ctx: ParseContext): JSONContent {
  const content = inlineToJson(children, ctx)
  return content.length > 0
    ? { type: "paragraph", content }
    : { type: "paragraph" }
}

function blocksToJson(nodes: Block[], ctx: ParseContext): JSONContent[] {
  return nodes.map((node) => blockToJson(node, ctx))
}

/** content が "block+" のノード用。空なら空段落を入れる (書き戻すときは捨てる) */
function nonEmptyBlocks(nodes: Block[], ctx: ParseContext): JSONContent[] {
  const content = blocksToJson(nodes, ctx)
  return content.length > 0 ? content : [{ type: "paragraph" }]
}

/** content が "paragraph block*" のノード用 */
function paragraphFirst(nodes: Block[], ctx: ParseContext): JSONContent[] {
  const content = blocksToJson(nodes, ctx)
  return content[0]?.type === "paragraph"
    ? content
    : [{ type: "paragraph" }, ...content]
}

const ALERT_RE = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/i

/**
 * remark-github-blockquote-alert がアラートとして扱う blockquote のうち、
 * `> [!NOTE]` の行のあとに本文が続く素直な形だけをアラートとして取り出す。
 */
function alertOf(node: Md.Blockquote): { type: string; rest: Block[] } | null {
  const first = node.children[0]
  if (first?.type !== "paragraph") return null
  const head = first.children[0]
  if (head?.type !== "text") return null
  const match = head.value.match(ALERT_RE)
  if (!match) return null
  const after = head.value.slice(match[0].length)
  const type = match[1].toLowerCase()
  if (after === "" && first.children.length === 1) {
    return { type, rest: node.children.slice(1) }
  }
  if (!after.startsWith("\n")) return null
  const remaining = after.slice(1)
  const children: Phrasing[] = remaining
    ? [{ ...head, value: remaining }, ...first.children.slice(1)]
    : first.children.slice(1)
  if (children.length === 0) return null
  return {
    type,
    rest: [{ ...first, children }, ...node.children.slice(1)],
  }
}

function listItemToJson(
  item: Md.ListItem,
  ctx: ParseContext,
  task: boolean,
): JSONContent {
  const content = paragraphFirst(item.children, ctx)
  return task
    ? {
        type: "taskItem",
        attrs: { checked: item.checked === true, spread: item.spread ?? false },
        content,
      }
    : {
        type: "listItem",
        attrs: { spread: item.spread ?? false },
        content,
      }
}

function blockToJson(node: Block, ctx: ParseContext): JSONContent {
  switch (node.type) {
    case "paragraph":
      return paragraph(node.children, ctx)
    case "heading": {
      const content = inlineToJson(node.children, ctx)
      return {
        type: "heading",
        attrs: { level: node.depth },
        ...(content.length > 0 ? { content } : {}),
      }
    }
    case "thematicBreak":
      return { type: "horizontalRule" }
    case "blockquote": {
      const alert = alertOf(node)
      if (alert) {
        return {
          type: "alert",
          attrs: { type: alert.type },
          content: nonEmptyBlocks(alert.rest, ctx),
        }
      }
      return { type: "blockquote", content: nonEmptyBlocks(node.children, ctx) }
    }
    case "list": {
      const task = node.children.some(
        (item) => typeof item.checked === "boolean",
      )
      const items = node.children.map((item) => listItemToJson(item, ctx, task))
      if (task) {
        return {
          type: "taskList",
          attrs: { spread: node.spread ?? false },
          content: items,
        }
      }
      return node.ordered
        ? {
            type: "orderedList",
            attrs: { start: node.start ?? 1, spread: node.spread ?? false },
            content: items,
          }
        : {
            type: "bulletList",
            attrs: { spread: node.spread ?? false },
            content: items,
          }
    }
    case "code":
      return {
        type: "codeBlock",
        attrs: { language: node.lang ?? null, meta: node.meta ?? null },
        ...(node.value
          ? { content: [{ type: "text", text: node.value }] }
          : {}),
      }
    case "math":
      return { type: "mathBlock", attrs: { latex: node.value } }
    case "table":
      return {
        type: "table",
        content: node.children.map((row, rowIndex) => ({
          type: "tableRow",
          content: row.children.map((cell, column) => ({
            type: rowIndex === 0 ? "tableHeader" : "tableCell",
            attrs: { align: node.align?.[column] ?? null },
            content: [paragraph(cell.children, ctx)],
          })),
        })),
      }
    case "footnoteDefinition":
      return {
        type: "footnoteDefinition",
        attrs: { label: node.label ?? node.identifier },
        content: nonEmptyBlocks(node.children, ctx),
      }
    default:
      throw new UnsupportedSyntax(node.type)
  }
}

// ---------------------------------------------------------------------------
// エディタの JSON → mdast
// ---------------------------------------------------------------------------

const MARK_ORDER = ["strike", "italic", "bold", "link"]

function sameMark(a: Mark, b: Mark): boolean {
  return (
    a.type === b.type && JSON.stringify(a.attrs) === JSON.stringify(b.attrs)
  )
}

function textContent(nodes: JSONContent[] | undefined): string {
  return (nodes ?? [])
    .map((node) =>
      node.type === "text" ? (node.text ?? "") : textContent(node.content),
    )
    .join("")
}

type Parent = { children: Phrasing[] }

function markToMdast(mark: Mark, content: JSONContent[]): Phrasing & Parent {
  switch (mark.type) {
    case "bold":
      return { type: "strong", children: [] }
    case "italic":
      return { type: "emphasis", children: [] }
    case "strike":
      return { type: "delete", children: [] }
    case "link": {
      const href = String(mark.attrs?.href ?? "")
      const label = textContent(content)
      const autolinkable =
        label === href ||
        `mailto:${label}` === href ||
        `http://${label}` === href
      const nested = content.some(
        (node) => node.type !== "text" || (node.marks?.length ?? 0) > 1,
      )
      // URL だけのリンクは URL のまま書く (段落の URL がリンクカードになるので
      // `[url](url)` や `<url>` に書き換えない)
      if (autolinkable && !nested) {
        const source = mark.attrs?.source
        const value = source === "angle" ? `<${label}>` : label
        if (source !== null || /^https?:\/\//i.test(label)) {
          return {
            type: "emphasis",
            children: [],
            data: { autolink: value },
          } as Phrasing & Parent
        }
      }
      return {
        type: "link",
        url: href,
        title: (mark.attrs?.title as string | null) ?? null,
        children: [],
      }
    }
    default:
      throw new UnsupportedSyntax(`mark:${mark.type}`)
  }
}

function markSpan(nodes: JSONContent[], start: number, mark: Mark): number {
  let end = start
  while (end < nodes.length && nodes[end].marks?.some((m) => sameMark(m, mark)))
    end++
  return end - start
}

type InlineContext = { inTable: boolean; inHeading: boolean }

function leafToMdast(node: JSONContent, ctx: InlineContext): Phrasing {
  switch (node.type) {
    case "text":
      return node.marks?.some((mark) => mark.type === "code")
        ? { type: "inlineCode", value: node.text ?? "" }
        : { type: "text", value: node.text ?? "" }
    case "hardBreak":
      if (ctx.inTable || ctx.inHeading) return { type: "text", value: " " }
      return {
        type: "html",
        value: node.attrs?.style === "spaces" ? "  \n" : "\\\n",
      }
    case "image":
      return {
        type: "image",
        url: String(node.attrs?.src ?? ""),
        alt: (node.attrs?.alt as string | null) ?? "",
        title: (node.attrs?.title as string | null) ?? null,
      }
    case "mathInline":
      return { type: "inlineMath", value: String(node.attrs?.latex ?? "") }
    case "footnoteReference": {
      const label = String(node.attrs?.label ?? "")
      return {
        type: "footnoteReference",
        identifier: label.toLowerCase(),
        label,
      }
    }
    default:
      throw new UnsupportedSyntax(node.type ?? "unknown")
  }
}

/** フラットな「マーク付きテキストの列」を入れ子の mdast に組み直す */
function inlineToMdast(
  nodes: JSONContent[] | undefined,
  ctx: InlineContext,
): Phrasing[] {
  const list = nodes ?? []
  const root: Phrasing[] = []
  const stack: { mark: Mark; node: Phrasing & Parent }[] = []
  const current = () => (stack.at(-1)?.node.children ?? root) as Phrasing[]

  list.forEach((node, index) => {
    const marks = (node.marks ?? []).filter((mark) => mark.type !== "code")
    let keep = 0
    while (
      keep < stack.length &&
      marks.some((mark) => sameMark(mark, stack[keep].mark))
    )
      keep++
    stack.length = keep

    // 後ろまで長く続くマークほど外側に置く。同じ長さなら MARK_ORDER の順
    const opening = marks
      .filter((mark) => !stack.some((open) => sameMark(open.mark, mark)))
      .sort(
        (a, b) =>
          markSpan(list, index, b) - markSpan(list, index, a) ||
          MARK_ORDER.indexOf(a.type) - MARK_ORDER.indexOf(b.type),
      )
    for (const mark of opening) {
      const span = list.slice(index, index + markSpan(list, index, mark))
      const element = markToMdast(mark, span)
      current().push(element)
      stack.push({ mark, node: element })
    }
    current().push(leafToMdast(node, ctx))
  })

  return resolveAutolinks(root)
}

/**
 * markToMdast が仮置きした URL だけのリンクを、文字列そのままの html ノードに置き換える。
 * mdast-util-to-markdown は「改行の直後の html」の改行を空白に変えてしまうので、
 * 隣り合う html ノード (改行 + URL など) は 1 つにまとめる。
 */
function resolveAutolinks(nodes: Phrasing[]): Phrasing[] {
  const result: Phrasing[] = []
  for (const node of nodes) {
    const autolink = (node.data as { autolink?: string } | undefined)?.autolink
    const resolved: Phrasing =
      autolink !== undefined
        ? { type: "html", value: autolink }
        : "children" in node
          ? ({
              ...node,
              children: resolveAutolinks(node.children as Phrasing[]),
            } as Phrasing)
          : node
    const previous = result.at(-1)
    if (previous?.type === "html" && resolved.type === "html") {
      previous.value += resolved.value
    } else {
      result.push(resolved)
    }
  }
  return result
}

function isEmptyParagraph(node: JSONContent): boolean {
  return node.type === "paragraph" && !node.content?.length
}

function blocksToMdast(nodes: JSONContent[] | undefined): Block[] {
  return (nodes ?? [])
    .filter((node) => !isEmptyParagraph(node))
    .map((node) => blockToMdast(node))
}

const inline = (nodes: JSONContent[] | undefined) =>
  inlineToMdast(nodes, { inTable: false, inHeading: false })

function listItemToMdast(node: JSONContent): Md.ListItem {
  return {
    type: "listItem",
    spread: node.attrs?.spread === true,
    checked: node.type === "taskItem" ? node.attrs?.checked === true : null,
    children: blocksToMdast(node.content) as Md.ListItem["children"],
  }
}

function blockToMdast(node: JSONContent): Block {
  switch (node.type) {
    case "paragraph":
      return { type: "paragraph", children: inline(node.content) }
    case "heading":
      return {
        type: "heading",
        depth: Number(node.attrs?.level ?? 1) as Md.Heading["depth"],
        children: inlineToMdast(node.content, {
          inTable: false,
          inHeading: true,
        }),
      }
    case "horizontalRule":
      return { type: "thematicBreak" }
    case "blockquote":
      return {
        type: "blockquote",
        children: blocksToMdast(node.content) as Md.Blockquote["children"],
      }
    case "alert": {
      const type = String(node.attrs?.type ?? "note")
      const marker = `[!${(ALERT_TYPES.includes(type as never) ? type : "note").toUpperCase()}]`
      const children = blocksToMdast(node.content) as Md.Blockquote["children"]
      const first = children[0]
      if (first?.type === "paragraph") {
        const [head, ...rest] = first.children
        children[0] = {
          ...first,
          children:
            head?.type === "html"
              ? [{ type: "html", value: `${marker}\n${head.value}` }, ...rest]
              : [{ type: "html", value: `${marker}\n` }, ...first.children],
        }
      } else {
        children.unshift({
          type: "paragraph",
          children: [{ type: "html", value: marker }],
        })
      }
      return { type: "blockquote", children }
    }
    case "bulletList":
    case "orderedList":
    case "taskList":
      return {
        type: "list",
        ordered: node.type === "orderedList",
        start:
          node.type === "orderedList" ? Number(node.attrs?.start ?? 1) : null,
        spread: node.attrs?.spread === true,
        children: (node.content ?? []).map(listItemToMdast),
      }
    case "codeBlock":
      return {
        type: "code",
        lang: (node.attrs?.language as string | null) || null,
        meta: (node.attrs?.meta as string | null) || null,
        value: textContent(node.content),
      }
    case "mathBlock":
      return { type: "math", value: String(node.attrs?.latex ?? "") }
    case "table": {
      const rows = node.content ?? []
      const align = (rows[0]?.content ?? []).map(
        (cell) => (cell.attrs?.align as Md.AlignType | undefined) ?? null,
      )
      return {
        type: "table",
        align,
        children: rows.map((row) => ({
          type: "tableRow",
          children: (row.content ?? []).map((cell) => ({
            type: "tableCell",
            children: (cell.content ?? [])
              .filter((block) => !isEmptyParagraph(block))
              .flatMap((block, index) => [
                ...(index > 0
                  ? [{ type: "text", value: " " } as Phrasing]
                  : []),
                ...inlineToMdast(block.content, {
                  inTable: true,
                  inHeading: false,
                }),
              ]),
          })),
        })),
      }
    }
    case "footnoteDefinition": {
      const label = String(node.attrs?.label ?? "")
      return {
        type: "footnoteDefinition",
        identifier: label.toLowerCase(),
        label,
        children: blocksToMdast(
          node.content,
        ) as Md.FootnoteDefinition["children"],
      }
    }
    case "rawMarkdown":
      return { type: "html", value: String(node.attrs?.source ?? "") }
    default:
      throw new UnsupportedSyntax(node.type ?? "unknown")
  }
}

const DEFAULT_MARKERS: ListMarkers = { bullet: "-", bulletOrdered: "." }

/** トップレベルのブロック 1 つを Markdown にする (末尾の改行なし)。空段落は "" */
export function blockToMarkdown(
  node: JSONContent,
  markers: ListMarkers = DEFAULT_MARKERS,
): string {
  if (node.type === "rawMarkdown") return String(node.attrs?.source ?? "")
  if (isEmptyParagraph(node)) return ""
  const tree: Md.Root = { type: "root", children: [blockToMdast(node)] }
  return stringifier(markers).stringify(tree).replace(/\n$/, "")
}

// ---------------------------------------------------------------------------
// 往復の検査
// ---------------------------------------------------------------------------

function clean(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(clean)
  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {}
    for (const [key, child] of Object.entries(value)) {
      if (key === "position" || key === "data" || child === undefined) continue
      result[key] = clean(child)
    }
    return result
  }
  return value
}

function sameTree(a: unknown, b: unknown): boolean {
  return JSON.stringify(clean(a)) === JSON.stringify(clean(b))
}

/** 脚注の参照は定義が無いと解析されないので、検査では仮の定義を後ろに足す */
function footnoteStubs(tree: Md.Root): string[] {
  const labels = new Set<string>()
  for (const node of tree.children) {
    if (node.type === "footnoteDefinition") {
      labels.add(node.label ?? node.identifier)
    }
  }
  return [...labels].map((label) => `[^${label}]: stub`)
}

function roundTrips(
  original: Block,
  markdown: string,
  stubs: string[],
): boolean {
  const tree = parse(
    stubs.length > 0 ? `${markdown}\n\n${stubs.join("\n\n")}` : markdown,
  )
  const children = tree.children.slice(0, tree.children.length - stubs.length)
  return children.length === 1 && sameTree(children[0], original)
}

// ---------------------------------------------------------------------------
// 公開 API
// ---------------------------------------------------------------------------

export type SourceBlock = {
  /** このブロックの元の Markdown */
  source: string
  /** 正規化したエディタの JSON の文字列。同じなら「触っていない」とみなす */
  key: string
  /** 箇条書きなら行頭の記号 (- * +) / 番号の後ろ (. または )) */
  marker: string | null
}

export type SourceMap = {
  prefix: string
  suffix: string
  blocks: SourceBlock[]
  /** gaps[i] は blocks[i] と blocks[i + 1] の間の文字列 */
  gaps: string[]
}

export type RawBlockReport = { index: number; type: string; reason: string }

export type ParsedMarkdown = {
  doc: JSONContent
  sourceMap: SourceMap
  rawBlocks: RawBlockReport[]
}

function listMarker(node: Block, source: string): string | null {
  if (node.type !== "list") return null
  if (!node.ordered) return source.trimStart()[0] ?? null
  return source.trimStart().match(/^\d+([.)])/)?.[1] ?? null
}

export function nodeKey(node: JSONContent): string {
  return JSON.stringify(node)
}

export function markdownToDocument(markdown: string): ParsedMarkdown {
  const tree = parse(markdown)
  const ctx: ParseContext = { source: markdown }
  const stubs = footnoteStubs(tree)
  const content: JSONContent[] = []
  const blocks: SourceBlock[] = []
  const gaps: string[] = []
  const rawBlocks: RawBlockReport[] = []

  tree.children.forEach((child, index) => {
    const source = slice(ctx, child)
    let json: JSONContent | null = null
    let reason = ""
    try {
      json = normalizeNode(blockToJson(child, ctx))
      if (!roundTrips(child, blockToMarkdown(json), stubs)) {
        reason = "往復で mdast が一致しない"
        json = null
      }
    } catch (error) {
      reason =
        error instanceof UnsupportedSyntax
          ? `未対応の構文: ${error.message}`
          : `変換エラー: ${String(error)}`
      json = null
    }
    if (!json) {
      json = normalizeNode({ type: "rawMarkdown", attrs: { source } })
      rawBlocks.push({ index, type: child.type, reason })
    }
    content.push(json)
    blocks.push({
      source,
      key: nodeKey(json),
      marker: listMarker(child, source),
    })
    const next = tree.children[index + 1]
    if (next) {
      gaps.push(
        markdown.slice(child.position?.end.offset, next.position?.start.offset),
      )
    }
  })

  const first = tree.children[0]?.position?.start.offset ?? markdown.length
  const last = tree.children.at(-1)?.position?.end.offset ?? markdown.length
  return {
    doc: {
      type: "doc",
      content: content.length > 0 ? content : [{ type: "paragraph" }],
    },
    sourceMap: {
      prefix: markdown.slice(0, first),
      suffix: markdown.slice(last),
      blocks,
      gaps,
    },
    rawBlocks,
  }
}

type Segment = {
  node: JSONContent
  original: number | null
  text: string
  marker: string | null
}

const isList = (node: JSONContent) =>
  node.type === "bulletList" ||
  node.type === "orderedList" ||
  node.type === "taskList"

/**
 * 隣り合う箇条書きは記号を変えないと 1 つの箇条書きにくっつくので、
 * 前後の箇条書きと違う記号を選ぶ
 */
function chooseMarkers(
  node: JSONContent,
  neighbours: (string | null)[],
): ListMarkers {
  const ordered = node.type === "orderedList"
  const candidates = ordered ? [".", ")"] : ["-", "*", "+"]
  const marker =
    candidates.find((candidate) => !neighbours.includes(candidate)) ??
    candidates[0]
  return ordered
    ? { bullet: "-", bulletOrdered: marker as ListMarkers["bulletOrdered"] }
    : { bullet: marker as ListMarkers["bullet"], bulletOrdered: "." }
}

export type SerializeOptions = {
  /** 元の Markdown。指定するとそのブロックは元の文字列のまま書き戻す */
  sourceMap?: SourceMap | null
  /** ブロックの Markdown 化をキャッシュしたいときに差し替える */
  serializeBlock?: (node: JSONContent, markers: ListMarkers) => string
  keyOf?: (node: JSONContent) => string
}

export function documentToMarkdown(
  doc: JSONContent,
  options: SerializeOptions = {},
): string {
  const { sourceMap = null, serializeBlock = blockToMarkdown } = options
  const keyOf = options.keyOf ?? nodeKey
  const nodes = doc.content ?? []

  // 元のブロックと同じ内容のノードを、順番を保ったまま対応付ける
  const byKey = new Map<string, number[]>()
  sourceMap?.blocks.forEach((block, index) => {
    const list = byKey.get(block.key) ?? []
    list.push(index)
    byKey.set(block.key, list)
  })
  let cursor = 0
  const segments: Segment[] = nodes.map((node) => {
    const candidates = sourceMap ? byKey.get(keyOf(node)) : undefined
    const match = candidates?.find((index) => index >= cursor)
    if (sourceMap && match !== undefined) {
      cursor = match + 1
      const block = sourceMap.blocks[match]
      return { node, original: match, text: block.source, marker: block.marker }
    }
    return { node, original: null, text: "", marker: null }
  })

  segments.forEach((segment, index) => {
    if (segment.original !== null) return
    if (isList(segment.node)) {
      const neighbours = [segments[index - 1], segments[index + 1]]
        .filter((other) => other && isList(other.node))
        .map((other) => other.marker)
      const markers = chooseMarkers(segment.node, neighbours)
      segment.marker =
        segment.node.type === "orderedList"
          ? markers.bulletOrdered
          : markers.bullet
      segment.text = serializeBlock(segment.node, markers)
    } else {
      segment.text = serializeBlock(segment.node, DEFAULT_MARKERS)
    }
  })

  const present = segments.filter((segment) => segment.text !== "")
  if (present.length === 0) return ""

  let output = ""
  present.forEach((segment, index) => {
    const previous = present[index - 1]
    if (previous) {
      const consecutive =
        sourceMap &&
        previous.original !== null &&
        segment.original === previous.original + 1
      output += consecutive ? sourceMap.gaps[previous.original!] : "\n\n"
    }
    output += segment.text
  })

  if (sourceMap && sourceMap.blocks.length > 0) {
    return sourceMap.prefix + output + sourceMap.suffix
  }
  return `${output}\n`
}
