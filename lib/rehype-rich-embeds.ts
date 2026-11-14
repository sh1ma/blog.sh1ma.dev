import type { Element, ElementContent, Root } from "hast"
import type { Plugin } from "unified"
import {
  legacyOgpResolver,
  type OgpData,
  type OgpResolver,
  urlOnlyOgp,
} from "./ogp-fetcher"
import { collectStandaloneUrls } from "./standalone-url"

/**
 * 描画 1 回ごとに OGP の引き方を差し替えるときは、VFile の data に入れて渡す
 * (src/lib/render-markdown.ts)。無ければ src/data/ogp-cache.json だけを見る。
 */
export type RichEmbedsFileData = { resolveOgp?: OgpResolver }

function buildTweetEmbed(url: string): Element {
  return {
    type: "element",
    tagName: "blockquote",
    properties: {
      className: ["twitter-tweet"],
      "data-dnt": "true",
    },
    children: [
      {
        type: "element",
        tagName: "a",
        properties: { href: url },
        children: [{ type: "text", value: url }],
      },
    ],
  }
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s
  return `${s.slice(0, n - 1)}…`
}

function buildLinkCard(data: OgpData): Element {
  const body: Element = {
    type: "element",
    tagName: "div",
    properties: { className: ["link-card__body"] },
    children: [
      {
        type: "element",
        tagName: "div",
        properties: { className: ["link-card__title"] },
        children: [{ type: "text", value: truncate(data.title, 120) }],
      },
      ...(data.description
        ? [
            {
              type: "element",
              tagName: "div",
              properties: { className: ["link-card__desc"] },
              children: [
                { type: "text", value: truncate(data.description, 160) },
              ],
            } satisfies Element,
          ]
        : []),
      {
        type: "element",
        tagName: "div",
        properties: { className: ["link-card__meta"] },
        children: [
          ...(data.favicon
            ? [
                {
                  type: "element",
                  tagName: "img",
                  properties: {
                    className: ["link-card__favicon"],
                    src: data.favicon,
                    alt: "",
                    width: 16,
                    height: 16,
                    loading: "lazy",
                  },
                  children: [],
                } satisfies Element,
              ]
            : []),
          {
            type: "element",
            tagName: "span",
            properties: {},
            children: [{ type: "text", value: data.siteName ?? data.domain }],
          },
        ],
      },
    ],
  }

  const children: Element[] = [body]
  if (data.image) {
    children.push({
      type: "element",
      tagName: "div",
      properties: { className: ["link-card__thumb"] },
      children: [
        {
          type: "element",
          tagName: "img",
          properties: {
            src: data.image,
            alt: "",
            loading: "lazy",
          },
          children: [],
        },
      ],
    })
  }

  return {
    type: "element",
    tagName: "a",
    properties: {
      href: data.url,
      className: ["link-card"],
      target: "_blank",
      rel: ["noopener", "noreferrer"],
    },
    children,
  }
}

export const rehypeRichEmbeds: Plugin<[], Root> = () => {
  return async (tree, file) => {
    const targets = collectStandaloneUrls(tree)
    if (targets.length === 0) return

    // 表示のたびに外へは取りに行かない。保存済みの値 (ストレージ → JSON) を読むだけ
    const resolve =
      (file.data as RichEmbedsFileData).resolveOgp ?? legacyOgpResolver
    const ogpUrls = targets.filter((t) => t.kind === "ogp").map((t) => t.url)
    const found =
      ogpUrls.length > 0
        ? await resolve(ogpUrls).catch(() => new Map<string, OgpData>())
        : new Map<string, OgpData>()

    const replacements = targets.map((t) => {
      if (t.kind === "tweet") {
        return { target: t, node: buildTweetEmbed(t.url) }
      }
      const data = found.get(t.url)
      // リンク先は記事に書かれた URL のまま (保存済みの値は正規化した URL を持つ)
      const node = buildLinkCard(
        data ? { ...data, url: t.url } : urlOnlyOgp(t.url),
      )
      return { target: t, node }
    })

    for (const { target, node } of replacements) {
      const children = target.parent.children as ElementContent[]
      const idx = children.indexOf(target.paragraph as ElementContent)
      if (idx >= 0) children[idx] = node as ElementContent
    }
  }
}
