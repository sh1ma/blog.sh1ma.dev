import { readFileSync } from "node:fs"
import { join } from "node:path"
import type { JSONContent } from "@tiptap/core"
import { describe, expect, it } from "vitest"
import { collectLinkCardUrls } from "../../../../lib/link-card-urls"
import {
  documentToMarkdown,
  markdownToDocument,
} from "../../../plugins/markdown-editor/markdown"
import { createSchema } from "../../../plugins/markdown-editor/schema"
import { collectLinkCards, normalizeUri } from "./link-card"

const schema = createSchema()

type SeedPost = { slug: string; locale: string; data: { markdown: string } }
const posts: SeedPost[] = JSON.parse(
  readFileSync(
    join(import.meta.dirname, "..", "..", "..", "..", "seed", "seed.json"),
    "utf8",
  ),
).content.posts

function editorCards(markdown: string) {
  const doc = schema.nodeFromJSON(markdownToDocument(markdown).doc)
  return collectLinkCards(doc).map(({ url, kind }) => ({ url, kind }))
}

describe("collectLinkCards (エディタ)", () => {
  it("既存の全記事で、公開ページのカード / 埋め込みと同じ URL を返す", async () => {
    let total = 0
    for (const post of posts) {
      const expected = await collectLinkCardUrls(post.data.markdown)
      expect(
        editorCards(post.data.markdown),
        `${post.locale}/${post.slug}`,
      ).toEqual(expected)
      total += expected.length
    }
    expect(total).toBeGreaterThanOrEqual(24)
  })

  it("書き方・置き場所ごとに公開ページと一致する", async () => {
    const cases = [
      "<https://example.com/angle>",
      "https://example.com/bare",
      "[https://example.com/md](https://example.com/md)",
      "[title](https://example.com/titled)",
      "text https://example.com/inline",
      "**https://example.com/bold**",
      "`https://example.com/code`",
      "> https://example.com/quoted",
      "> [!NOTE]\n> https://example.com/alert-first",
      "> [!TIP]\n> text\n>\n> https://example.com/alert-second",
      "- https://example.com/tight-list\n- item",
      "- https://example.com/loose-list\n\n- item",
      "1. text\n\n   https://example.com/loose-ordered",
      "| a |\n| - |\n| https://example.com/table |",
      "https://example.com/日本語",
      "[https://example.com/%E6%97%A5](https://example.com/%E6%97%A5)",
      "https://example.com/trailing.",
      "https://x.com/sh1ma/status/1234567890",
      "  https://example.com/indented  ",
    ]
    for (const markdown of cases) {
      expect(editorCards(markdown), markdown).toEqual(
        await collectLinkCardUrls(markdown),
      )
    }
  })

  it("リンクになっていない (印の無い) URL の段落も、保存したときの公開ページと一致する", async () => {
    const texts = [
      "https://example.com/plain",
      "https://example.com/plain.",
      "https://example.com/a_(b)",
      "https://example.com/a)",
      " https://example.com/spaced ",
      "https://example.com/two words",
    ]
    for (const text of texts) {
      const json: JSONContent = {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text }] }],
      }
      const markdown = documentToMarkdown(json)
      const cards = collectLinkCards(schema.nodeFromJSON(json)).map(
        ({ url, kind }) => ({ url, kind }),
      )
      expect(cards, text).toEqual(await collectLinkCardUrls(markdown))
    }
  })

  it("段落の位置を返す", () => {
    const doc = schema.nodeFromJSON(
      markdownToDocument(
        "text\n\nhttps://example.com/\n\n> https://x.com/a/status/1",
      ).doc,
    )
    const cards = collectLinkCards(doc)
    expect(cards.map((card) => doc.nodeAt(card.pos)?.type.name)).toEqual([
      "paragraph",
      "paragraph",
    ])
    expect(cards.map((card) => card.kind)).toEqual(["ogp", "tweet"])
  })
})

describe("normalizeUri", () => {
  it("mdast-util-to-hast と同じく、URL に使えない文字だけを %エンコードする", () => {
    expect(normalizeUri("https://example.com/a?b=c&d=e#f")).toBe(
      "https://example.com/a?b=c&d=e#f",
    )
    expect(normalizeUri("https://example.com/日本")).toBe(
      "https://example.com/%E6%97%A5%E6%9C%AC",
    )
    expect(normalizeUri("https://example.com/%E6 x")).toBe(
      "https://example.com/%E6%20x",
    )
    expect(normalizeUri("https://example.com/50%")).toBe(
      "https://example.com/50%25",
    )
  })
})
