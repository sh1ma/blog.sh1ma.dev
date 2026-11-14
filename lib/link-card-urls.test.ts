import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { renderMarkdown } from "../src/lib/render-markdown"
import { collectLinkCardUrls } from "./link-card-urls"
import { parseTweetUrl } from "./standalone-url"

type SeedPost = { slug: string; locale: string; data: { markdown: string } }

const posts: SeedPost[] = JSON.parse(
  readFileSync(join(import.meta.dirname, "..", "seed", "seed.json"), "utf8"),
).content.posts

/** 公開ページの HTML でカード / X の埋め込みになった URL (出てくる順) */
function embedsIn(html: string) {
  return [
    ...html.matchAll(
      /<a href="([^"]*)" class="link-card"|<blockquote class="twitter-tweet"[^>]*><a href="([^"]*)"/g,
    ),
  ].map((m) =>
    m[1] !== undefined
      ? { url: m[1], kind: "ogp" }
      : { url: m[2], kind: "tweet" },
  )
}

const decode = (url: string) => url.replaceAll("&#x26;", "&")

describe("collectLinkCardUrls", () => {
  it("既存の全記事で、公開ページのカード / 埋め込みと同じ URL を同じ順で返す", async () => {
    let total = 0
    for (const post of posts) {
      const html = await renderMarkdown(post.data.markdown)
      const expected = embedsIn(html).map((e) => ({ ...e, url: decode(e.url) }))
      const actual = await collectLinkCardUrls(post.data.markdown)
      expect(actual, `${post.locale}/${post.slug}`).toEqual(expected)
      total += actual.length
    }
    // 既存記事にリンクカードがあることも確かめる (0 件どうしの一致で通らないように)
    expect(total).toBeGreaterThanOrEqual(24)
  })

  it("書き方の違い (<url> / 裸の URL / [url](url)) と、カードにならない段落", async () => {
    const markdown = [
      "<https://example.com/angle>",
      "https://example.com/bare",
      "[https://example.com/md](https://example.com/md)",
      "[title](https://example.com/titled)",
      "text https://example.com/inline",
      "**https://example.com/bold**",
      "> https://example.com/quoted",
      "- https://example.com/tight-list",
      "https://x.com/sh1ma/status/1234567890",
    ].join("\n\n")
    const html = await renderMarkdown(markdown)
    const actual = await collectLinkCardUrls(markdown)
    expect(actual).toEqual(embedsIn(html))
    expect(actual).toEqual([
      { url: "https://example.com/angle", kind: "ogp" },
      { url: "https://example.com/bare", kind: "ogp" },
      { url: "https://example.com/md", kind: "ogp" },
      { url: "https://example.com/quoted", kind: "ogp" },
      { url: "https://x.com/sh1ma/status/1234567890", kind: "tweet" },
    ])
  })
})

describe("parseTweetUrl", () => {
  it("X / Twitter の投稿 URL からユーザー名と ID", () => {
    expect(parseTweetUrl("https://x.com/sh1ma/status/123?s=20")).toEqual({
      user: "sh1ma",
      id: "123",
    })
    expect(parseTweetUrl("https://twitter.com/jack/statuses/20")).toEqual({
      user: "jack",
      id: "20",
    })
    expect(parseTweetUrl("https://x.com/sh1ma")).toBeNull()
  })
})
