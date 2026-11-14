import type { Element, ElementContent, Root, Text } from "hast"

// 「URL だけの段落」の判定。公開ページ (rehype-rich-embeds) と、保存時に OGP を取りに行く
// プラグイン (link-card-urls.ts) の両方がこれを使う。管理画面のエディタ
// (src/admin/app/editor/link-card.ts) も同じ規則 (前後の空白を除いて URL 1 つ、
// リンクなら文字列と href が同じ) で判定する。

export const TWEET_URL_RE =
  /^https?:\/\/(?:www\.)?(?:x|twitter)\.com\/([^/]+)\/status(?:es)?\/(\d+)/i

/** 段落の文字列そのものが URL か (裸の URL として書かれた段落) */
export const STANDALONE_URL_TEXT_RE = /^https?:\/\/\S+$/i

export function isTweetUrl(url: string): boolean {
  return TWEET_URL_RE.test(url)
}

/** X (Twitter) の投稿 URL ならユーザー名と投稿 ID */
export function parseTweetUrl(
  url: string,
): { user: string; id: string } | null {
  const match = url.match(TWEET_URL_RE)
  return match ? { user: match[1], id: match[2] } : null
}

function isWhitespaceText(node: ElementContent): boolean {
  return node.type === "text" && /^\s*$/.test((node as Text).value)
}

export function findStandaloneUrl(paragraph: Element): string | null {
  const nonWs = paragraph.children.filter((c) => !isWhitespaceText(c))
  if (nonWs.length !== 1) return null
  const only = nonWs[0]

  if (only.type === "text") {
    const value = (only as Text).value.trim()
    if (STANDALONE_URL_TEXT_RE.test(value) && !/\s/.test(value)) return value
    return null
  }

  if (only.type === "element" && (only as Element).tagName === "a") {
    const link = only as Element
    const href = link.properties?.href
    if (typeof href !== "string") return null
    const text = link.children
      .map((c) => (c.type === "text" ? (c as Text).value : ""))
      .join("")
      .trim()
    if (text !== href) return null
    if (!/^https?:\/\//i.test(href)) return null
    return href
  }

  return null
}

export type StandaloneUrlTarget = {
  paragraph: Element
  parent: Element | Root
  index: number
  url: string
  kind: "tweet" | "ogp"
}

export function collectStandaloneUrls(root: Root): StandaloneUrlTarget[] {
  const targets: StandaloneUrlTarget[] = []
  const walk = (node: Element | Root) => {
    const children = node.children as ElementContent[]
    for (let i = 0; i < children.length; i++) {
      const child = children[i]
      if (child.type !== "element") continue
      const el = child as Element
      if (el.tagName === "p") {
        const url = findStandaloneUrl(el)
        if (url) {
          targets.push({
            paragraph: el,
            parent: node as Element | Root,
            index: i,
            url,
            kind: isTweetUrl(url) ? "tweet" : "ogp",
          })
          continue
        }
      }
      walk(el)
    }
  }
  walk(root)
  return targets
}
