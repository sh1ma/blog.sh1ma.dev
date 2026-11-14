import { type Editor, Extension } from "@tiptap/core"
import type { Node as ProseMirrorNode } from "@tiptap/pm/model"
import {
  type EditorState,
  NodeSelection,
  Plugin,
  PluginKey,
  Selection,
  TextSelection,
} from "@tiptap/pm/state"
import {
  Decoration,
  DecorationSet,
  type EditorView,
  type NodeView,
} from "@tiptap/pm/view"
import { domainOf, googleFavicon } from "../../../../lib/ogp-fetcher"
import {
  parseTweetUrl,
  STANDALONE_URL_TEXT_RE,
} from "../../../../lib/standalone-url"
import type { OgpStore, OgpView } from "../lib/ogp-store"
import {
  collectLinkCards,
  type EditorLinkCard,
  type LinkCardKind,
} from "./link-card"

// 「URL だけの段落」を、公開ページと同じ見た目のカードで表示する。
// 文書 (段落 + URL のリンク) は変えず、段落の node view だけを差し替えるので、
// 保存される Markdown は今までと同じ (開いただけで値が変わらない)。
// - キャレットが段落の中にある間はカードにせず、URL の文字のまま編集できる
// - カードをクリックすると段落ごと選択 (NodeSelection) し、NotionEditor のポップオーバーで操作する
// - 空の段落に URL だけを貼ると、リンクにしてカードにする

type CardSpec = { url: string; kind: LinkCardKind }
type LinkCardsState = {
  cards: EditorLinkCard[]
  decorations: DecorationSet
  focused: boolean
}

export const linkCardsKey = new PluginKey<LinkCardsState>("bwaLinkCards")

/** pos の段落がカードとして表示されていればその内容 */
export function linkCardAt(
  state: EditorState,
  pos: number,
): EditorLinkCard | null {
  return (
    linkCardsKey.getState(state)?.cards.find((card) => card.pos === pos) ?? null
  )
}

/** キャレット (文字の選択) が段落の中にあるか。あるならカードにせず文字のまま見せる */
function revealed(
  state: EditorState,
  focused: boolean,
  card: EditorLinkCard,
): boolean {
  const { selection } = state
  if (!focused || !(selection instanceof TextSelection)) return false
  const node = state.doc.nodeAt(card.pos)
  if (!node) return false
  const from = card.pos + 1
  const to = card.pos + node.nodeSize - 1
  return selection.from <= to && selection.to >= from
}

function buildState(
  state: EditorState,
  cards: EditorLinkCard[],
  focused: boolean,
): LinkCardsState {
  const decorations = cards.flatMap((card) => {
    if (revealed(state, focused, card)) return []
    const node = state.doc.nodeAt(card.pos)
    if (!node) return []
    const spec: { linkCard: CardSpec } = {
      linkCard: { url: card.url, kind: card.kind },
    }
    return [Decoration.node(card.pos, card.pos + node.nodeSize, {}, spec)]
  })
  return {
    cards,
    decorations: DecorationSet.create(state.doc, decorations),
    focused,
  }
}

function cardSpecOf(decorations: readonly Decoration[]): CardSpec | null {
  for (const decoration of decorations) {
    const spec = (decoration.spec as { linkCard?: CardSpec }).linkCard
    if (spec) return spec
  }
  return null
}

// ---------------------------------------------------------------------------
// カードの DOM (公開ページの rehype-rich-embeds の buildLinkCard と同じ構造)
// ---------------------------------------------------------------------------

function el(tag: string, className: string, text?: string): HTMLElement {
  const element = document.createElement(tag)
  element.className = className
  if (text !== undefined) element.textContent = text
  return element
}

/** 子を足す (Workers の型の Element.append と衝突しないよう appendChild を使う) */
function add(parent: HTMLElement, ...nodes: Node[]) {
  for (const node of nodes) parent.appendChild(node)
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s
  return `${s.slice(0, n - 1)}…`
}

function image(className: string, src: string): HTMLImageElement {
  const img = document.createElement("img")
  img.className = className
  img.src = src
  img.alt = ""
  img.loading = "lazy"
  img.referrerPolicy = "no-referrer"
  img.decoding = "async"
  return img
}

function renderOgpCard(card: HTMLElement, url: string, view: OgpView) {
  card.replaceChildren()
  card.dataset.state = view.status
  const domain = domainOf(url)
  const data =
    view.status === "ok"
      ? view.data
      : { url, title: url, domain, favicon: googleFavicon(domain) }

  const body = el("div", "bwa-linkcard__body")
  add(body, el("div", "bwa-linkcard__title", truncate(data.title, 120)))
  const description =
    view.status === "ok"
      ? data.description
      : view.status === "loading"
        ? "OGP を読み込み中…"
        : `OGP を取得できませんでした (${view.error})。公開ページでは URL だけのカードになります`
  if (description) {
    const desc = el("div", "bwa-linkcard__desc", truncate(description, 160))
    if (view.status === "failed" || view.status === "error") {
      desc.dataset.tone = "danger"
    }
    add(body, desc)
  }
  const meta = el("div", "bwa-linkcard__meta")
  if (data.favicon) add(meta, image("bwa-linkcard__favicon", data.favicon))
  add(meta, el("span", "", data.siteName ?? data.domain))
  add(body, meta)
  add(card, body)

  if (view.status === "ok" && data.image) {
    const thumb = el("div", "bwa-linkcard__thumb")
    const img = image("", data.image)
    img.addEventListener("error", () => thumb.remove())
    add(thumb, img)
    add(card, thumb)
  }
}

function renderTweetCard(card: HTMLElement, url: string) {
  const tweet = parseTweetUrl(url)
  card.replaceChildren()
  card.dataset.state = "tweet"
  const icon = el("div", "bwa-linkcard__xicon", "𝕏")
  icon.setAttribute("aria-hidden", "true")
  const body = el("div", "bwa-linkcard__body")
  add(
    body,
    el(
      "div",
      "bwa-linkcard__title",
      tweet ? `X の投稿 · @${tweet.user}` : "X の投稿",
    ),
    el("div", "bwa-linkcard__desc", tweet ? `投稿 ID: ${tweet.id}` : url),
    el("div", "bwa-linkcard__meta", "公開ページで埋め込み表示されます"),
  )
  add(card, icon, body)
}

/** 段落の node view。カードのときは中身を ProseMirror に描かせない (contentDOM なし) */
class ParagraphView implements NodeView {
  dom: HTMLElement
  contentDOM?: HTMLElement
  private spec: CardSpec | null
  private unsubscribe: (() => void) | null = null

  constructor(decorations: readonly Decoration[], store: OgpStore) {
    this.spec = cardSpecOf(decorations)
    if (!this.spec) {
      this.dom = document.createElement("p")
      this.contentDOM = this.dom
      return
    }
    const { url, kind } = this.spec
    const card = el("div", "bwa-linkcard")
    card.contentEditable = "false"
    card.dataset.kind = kind
    card.dataset.url = url
    card.dataset.testid = "link-card"
    card.title = url
    this.dom = card
    if (kind === "tweet") {
      renderTweetCard(card, url)
    } else {
      const render = () => renderOgpCard(card, url, store.get(url))
      this.unsubscribe = store.subscribe(url, render)
      render()
    }
  }

  update(node: ProseMirrorNode, decorations: readonly Decoration[]): boolean {
    if (node.type.name !== "paragraph") return false
    const next = cardSpecOf(decorations)
    if (!next || !this.spec) return !next && !this.spec
    return next.url === this.spec.url && next.kind === this.spec.kind
  }

  selectNode() {
    this.dom.classList.add("bwa-linkcard--selected")
  }

  deselectNode() {
    this.dom.classList.remove("bwa-linkcard--selected")
  }

  ignoreMutation() {
    // カードの中身は自分で描くので、ProseMirror に DOM の変化を読ませない
    return this.spec !== null
  }

  destroy() {
    this.unsubscribe?.()
  }
}

// ---------------------------------------------------------------------------
// 操作
// ---------------------------------------------------------------------------

/** 貼り付けで URL をカードにしてよい場所 (最上位・引用・アラートの空の段落) */
function pasteTarget(state: EditorState): number | null {
  const { selection } = state
  if (!selection.empty || !(selection instanceof TextSelection)) return null
  const { $from } = selection
  const paragraph = $from.parent
  if (paragraph.type.name !== "paragraph" || paragraph.content.size > 0) {
    return null
  }
  const container = $from.node($from.depth - 1)
  if (!["doc", "blockquote", "alert"].includes(container.type.name)) {
    return null
  }
  return $from.before()
}

function pasteUrl(view: EditorView, pos: number, url: string) {
  const { state } = view
  const { schema } = state
  const link = schema.marks.link.create({ href: url })
  const paragraph = schema.nodes.paragraph.create(
    null,
    schema.text(url, [link]),
  )
  const tr = state.tr.replaceWith(
    pos,
    pos + (state.doc.nodeAt(pos)?.nodeSize ?? 2),
    paragraph,
  )
  // カードの下にキャレットを置く (空の段落が無ければ作る)
  const after = pos + paragraph.nodeSize
  const next = tr.doc.resolve(after).nodeAfter
  if (!(next?.type.name === "paragraph" && next.content.size === 0)) {
    tr.insert(after, schema.nodes.paragraph.create())
  }
  tr.setSelection(TextSelection.create(tr.doc, after + 1))
  view.dispatch(tr.scrollIntoView())
}

function selectCard(view: EditorView, pos: number) {
  view.dispatch(
    view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)),
  )
}

function handleArrow(view: EditorView, event: KeyboardEvent): boolean {
  const dir =
    event.key === "ArrowDown" || event.key === "ArrowRight"
      ? 1
      : event.key === "ArrowUp" || event.key === "ArrowLeft"
        ? -1
        : 0
  if (dir === 0 || event.shiftKey || event.altKey || event.metaKey) {
    return false
  }
  const { state } = view
  const { selection } = state

  // 選択中のカードから出る
  if (selection instanceof NodeSelection && linkCardAt(state, selection.from)) {
    const $pos = state.doc.resolve(dir > 0 ? selection.to : selection.from)
    const next = Selection.findFrom($pos, dir, true)
    if (!next) return false
    const card = linkCardAt(state, next.$from.before())
    view.dispatch(
      state.tr.setSelection(
        card ? NodeSelection.create(state.doc, card.pos) : next,
      ),
    )
    return true
  }

  // 上下の行移動でカードに入るときはカードを選択する (文字のまま見せない)
  if (!(selection instanceof TextSelection) || !selection.empty) return false
  const { $from } = selection
  if (!$from.parent.isTextblock) return false
  const vertical = event.key === "ArrowUp" || event.key === "ArrowDown"
  const atEdge = vertical
    ? view.endOfTextblock(dir > 0 ? "down" : "up")
    : dir > 0
      ? $from.parentOffset === $from.parent.content.size
      : $from.parentOffset === 0
  if (!atEdge) return false
  const $edge = state.doc.resolve(dir > 0 ? $from.after() : $from.before())
  const next = Selection.findFrom($edge, dir, true)
  if (!next) return false
  const card = linkCardAt(state, next.$from.before())
  if (!card) return false
  selectCard(view, card.pos)
  return true
}

export type LinkCardOptions = { store: OgpStore | null }

declare module "@tiptap/core" {
  interface Storage {
    bwaLinkCards: { store: OgpStore | null }
  }
}

/** 文書のリンクカードの OGP をすべてサーバーで取り直す (… メニューの「リンクカードを再取得」) */
export async function refreshLinkCards(
  editor: Editor,
): Promise<{ total: number; failed: number }> {
  const store = editor.storage.bwaLinkCards?.store
  if (!store) return { total: 0, failed: 0 }
  const urls = [
    ...new Set(
      collectLinkCards(editor.state.doc)
        .filter((card) => card.kind === "ogp")
        .map((card) => card.url),
    ),
  ]
  let failed = 0
  for (const url of urls) {
    await store.refresh(url)
    if (store.get(url).status !== "ok") failed++
  }
  return { total: urls.length, failed }
}

export const LinkCards = Extension.create<LinkCardOptions>({
  name: "bwaLinkCards",
  // Link の貼り付け処理 (priority 1000) より先に動く
  priority: 1100,

  addOptions() {
    return { store: null }
  },

  addStorage() {
    return { store: this.options.store }
  },

  addProseMirrorPlugins() {
    const store = this.options.store
    if (!store) return []
    return [
      new Plugin<LinkCardsState>({
        key: linkCardsKey,
        state: {
          init: (_config, state) =>
            buildState(state, collectLinkCards(state.doc), false),
          apply: (tr, previous, _oldState, newState) => {
            const meta = tr.getMeta(linkCardsKey) as
              | { focused: boolean }
              | undefined
            const focused = meta?.focused ?? previous.focused
            if (!tr.docChanged && !tr.selectionSet && !meta) return previous
            const cards = tr.docChanged
              ? collectLinkCards(newState.doc)
              : previous.cards
            return buildState(newState, cards, focused)
          },
        },
        props: {
          decorations: (state) => linkCardsKey.getState(state)?.decorations,
          nodeViews: {
            paragraph: (_node, _view, _getPos, decorations) =>
              new ParagraphView(decorations, store),
          },
          handleDOMEvents: {
            focus: (view) => {
              view.dispatch(
                view.state.tr.setMeta(linkCardsKey, { focused: true }),
              )
              return false
            },
            blur: (view) => {
              view.dispatch(
                view.state.tr.setMeta(linkCardsKey, { focused: false }),
              )
              return false
            },
          },
          handleClickOn: (view, _pos, node, nodePos, event) => {
            if (node.type.name !== "paragraph") return false
            const target = event.target as HTMLElement | null
            if (!target?.closest?.(".bwa-linkcard")) return false
            if (!linkCardAt(view.state, nodePos)) return false
            selectCard(view, nodePos)
            return true
          },
          handleKeyDown: (view, event) => handleArrow(view, event),
          handlePaste: (view, event) => {
            if (!view.editable) return false
            if ((event.clipboardData?.files.length ?? 0) > 0) return false
            const text = event.clipboardData?.getData("text/plain").trim() ?? ""
            if (!STANDALONE_URL_TEXT_RE.test(text)) return false
            const pos = pasteTarget(view.state)
            if (pos === null) return false
            pasteUrl(view, pos, text)
            return true
          },
        },
      }),
    ]
  },
})
