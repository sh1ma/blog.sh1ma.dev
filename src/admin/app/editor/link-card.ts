import type { Node as ProseMirrorNode } from "@tiptap/pm/model"
import {
  isTweetUrl,
  STANDALONE_URL_TEXT_RE,
} from "../../../../lib/standalone-url"

// エディタの文書のうち、公開ページでリンクカード / X の埋め込みになる段落を探す。
// 文書の構造は変えない (段落の中身は URL のリンク 1 つのまま。カードは見た目だけ)。
// 判定は公開ページ (lib/standalone-url.ts の findStandaloneUrl) と同じ規則を
// ProseMirror の文書に当てはめたもので、link-card.test.ts で既存の全記事について
// 公開ページの結果と一致することを確かめている。

export type LinkCardKind = "ogp" | "tweet"

export type EditorLinkCard = {
  /** 段落の位置 (段落の直前) */
  pos: number
  url: string
  kind: LinkCardKind
}

/**
 * mdast-util-to-hast がリンクの href に掛ける URL の正規化 (micromark-util-sanitize-uri の
 * normalizeUri と同じ規則)。公開ページは「リンクの文字列と href が同じ」ときだけカードにするので、
 * 日本語などを含む URL は href だけが %エンコードされてカードにならない。
 */
export function normalizeUri(value: string): string {
  const result: string[] = []
  let start = 0
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index)
    let replace = ""
    let skip = 0
    if (
      code === 37 &&
      /[A-Za-z0-9]{2}/.test(value.slice(index + 1, index + 3))
    ) {
      skip = 2
    } else if (code < 128) {
      if (!/[!#$&-;=?-Z_a-z~]/.test(String.fromCharCode(code))) {
        replace = String.fromCharCode(code)
      }
    } else if (code > 55_295 && code < 57_344) {
      const next = value.charCodeAt(index + 1)
      if (code < 56_320 && next > 56_319 && next < 57_344) {
        replace = String.fromCharCode(code, next)
        skip = 1
      } else {
        replace = "�"
      }
    } else {
      replace = String.fromCharCode(code)
    }
    if (replace) {
      result.push(value.slice(start, index), encodeURIComponent(replace))
      start = index + skip + 1
    }
    index += skip
  }
  return result.join("") + value.slice(start)
}

/**
 * GFM の URL の自動リンクは末尾の句読点や閉じていない ) をリンクに含めない。
 * リンクになっていない (印の無い) URL の段落は、保存し直すと自動リンクで読まれるので、
 * 末尾まで丸ごとリンクになるものだけをカードとみなす。
 */
function autolinksWhole(url: string): boolean {
  if (/[?!.,:*_~]$/.test(url)) return false
  if (url.endsWith(")")) {
    const open = url.split("(").length - 1
    const close = url.split(")").length - 1
    if (close > open) return false
  }
  return !/[<>`"']/.test(url)
}

/** 段落の中身が「URL だけ」ならその URL */
export function linkCardUrlOf(paragraph: ProseMirrorNode): string | null {
  if (paragraph.type.name !== "paragraph") return null
  const parts: ProseMirrorNode[] = []
  let inlineOnly = true
  paragraph.forEach((child) => {
    if (!child.isText) {
      inlineOnly = false
      return
    }
    // 公開ページの判定と同じく、空白だけの (印の無い) 文字は数えない
    if (child.marks.length === 0 && /^\s*$/.test(child.text ?? "")) return
    parts.push(child)
  })
  if (!inlineOnly || parts.length !== 1) return null
  const [only] = parts
  const text = only.text ?? ""
  if (only.marks.length === 0) {
    const value = text.trim()
    return STANDALONE_URL_TEXT_RE.test(value) && autolinksWhole(value)
      ? value
      : null
  }
  if (only.marks.length !== 1 || only.marks[0].type.name !== "link") {
    return null
  }
  const href = only.marks[0].attrs.href
  if (typeof href !== "string" || !/^https?:\/\//i.test(href)) return null
  return text.trim() === normalizeUri(href) ? href : null
}

const BLOCK_CONTAINERS = new Set(["blockquote", "alert"])
const LISTS = new Set(["bulletList", "orderedList", "taskList"])

/**
 * 公開ページで <p> として出る段落のうちカードになるもの。
 * - 最上位・引用・アラートの中の段落
 * - 箇条書きの中は、項目の間に空行のある (loose な) リストだけ (tight なリストの段落は <p> にならない)
 * - 表のセル・脚注・Markdown のまま保持しているブロックの中は対象外
 */
export function collectLinkCards(doc: ProseMirrorNode): EditorLinkCard[] {
  const cards: EditorLinkCard[] = []
  const visit = (parent: ProseMirrorNode, start: number, wrapsP: boolean) => {
    parent.forEach((child, offset) => {
      const pos = start + offset
      const name = child.type.name
      if (name === "paragraph") {
        if (!wrapsP) return
        const url = linkCardUrlOf(child)
        if (url)
          cards.push({ pos, url, kind: isTweetUrl(url) ? "tweet" : "ogp" })
        return
      }
      if (BLOCK_CONTAINERS.has(name)) {
        visit(child, pos + 1, true)
        return
      }
      if (LISTS.has(name)) {
        let loose = child.attrs.spread === true
        child.forEach((item) => {
          if (item.attrs.spread === true) loose = true
        })
        child.forEach((item, itemOffset) => {
          visit(item, pos + 1 + itemOffset + 1, loose)
        })
      }
    })
  }
  visit(doc, 0, true)
  return cards
}
