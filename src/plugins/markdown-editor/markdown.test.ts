import { readFile } from "node:fs/promises"
import type { JSONContent } from "@tiptap/core"
import { describe, expect, test } from "vitest"
import { renderMarkdown } from "../../lib/render-markdown"
import {
  blockToMarkdown,
  documentToMarkdown,
  markdownToDocument,
} from "./markdown"

type SeedPost = {
  slug: string
  locale: string
  data: { markdown: string }
}

const seed = JSON.parse(
  await readFile(new URL("../../../seed/seed.json", import.meta.url), "utf8"),
) as { content: { posts: SeedPost[] } }
const posts = seed.content.posts

/** 改行やタグ間の空白の違いだけを無視して HTML を比べる */
async function html(markdown: string) {
  return (await renderMarkdown(markdown)).replace(/>\s+</g, "><").trim()
}

describe("既存の全記事", () => {
  test("記事が 1 件以上ある", () => {
    expect(posts.length).toBeGreaterThan(0)
  })

  test.each(
    posts.map((post) => [`${post.locale}/${post.slug}`, post] as const),
  )("%s", async (_name, post) => {
    const original = post.data.markdown
    const parsed = markdownToDocument(original)

    // 触っていなければ元の文字列のまま
    expect(
      documentToMarkdown(parsed.doc, { sourceMap: parsed.sourceMap }),
    ).toBe(original)

    // 元の文字列を使わず全ブロックを直列化しても、表示される HTML は同じ
    const rewritten = documentToMarkdown(parsed.doc)
    expect(await html(rewritten)).toBe(await html(original))

    if (parsed.rawBlocks.length > 0) {
      console.info(
        `[raw] ${post.locale}/${post.slug}: ${JSON.stringify(parsed.rawBlocks)}`,
      )
    }
  })
})

const fixtures: Record<string, string> = {
  見出し: "# 見出し1\n\n## 見出し2\n\n###### 見出し6\n",
  インライン:
    '**太字** と *斜体* と ~~打ち消し~~ と `code` と [リンク](https://example.com "title")\n',
  入れ子: "**太字の中の [リンク](https://example.com) と `code`** の後ろ\n",
  画像: "![代替テキスト](/_emdash/api/media/file/01ABC.png)\n",
  箇条書き: "- 1 つめ\n- 2 つめ\n  - 入れ子\n- 3 つめ\n",
  空行のある箇条書き: "- 1 つめ\n\n- 2 つめ\n",
  番号付き: "3. 三\n4. 四\n",
  タスクリスト: "- [ ] まだ\n- [x] 済み\n",
  引用: "> 引用の\n> 本文\n",
  アラート:
    "> [!NOTE]\n> ノート\n\n> [!WARNING]\n> 警告の 1 行目\n> 2 行目\n\n> [!TIP]\n> - 箇条書き\n",
  コード: '```ts title="a.ts"\nconst a = 1\n\tconsole.log(a)\n```\n',
  言語なしのコード: "```\nplain\n```\n",
  表: "| 左 | 中 | 右 |\n| :-- | :-: | --: |\n| a | `b` | **c** |\n| d | e | f |\n",
  水平線: "前\n\n---\n\n後\n",
  数式: "インライン $E = mc^2$ と\n\n$$\n\\int_0^1 x\\,dx\n$$\n",
  脚注: "本文[^1]\n\n[^1]: 脚注の本文\n",
  改行: "行末スペース  \n次の行\\\nその次\n",
  ソフト改行: "1 行目\n2 行目\n",
  URLだけの段落: "https://example.com/path_with_underscore\n",
  山かっこのURL: "<https://example.com>\n",
  リンクカードの前後: "前の段落\n\nhttps://blog.sh1ma.dev/\n\n後の段落\n",
  改行の直後のURL: "手順は以下から  \nhttps://rclone.org/install/\n",
  URLで始まるアラート: "> [!NOTE]\n> https://example.com\n",
}

describe("書式ごとの往復", () => {
  test.each(Object.entries(fixtures))("%s", async (_name, markdown) => {
    const parsed = markdownToDocument(markdown)
    expect(parsed.rawBlocks).toEqual([])
    const rewritten = documentToMarkdown(parsed.doc)
    expect(await html(rewritten)).toBe(await html(markdown))
  })

  test("URL だけの段落は自動リンクの書き方に変えない", () => {
    for (const markdown of [
      "https://example.com/a_b\n",
      "<https://example.com>\n",
    ]) {
      const parsed = markdownToDocument(markdown)
      expect(documentToMarkdown(parsed.doc)).toBe(markdown)
    }
  })

  test("改行の書き方 (行末スペース / バックスラッシュ) を保つ", () => {
    const markdown = fixtures.改行
    expect(documentToMarkdown(markdownToDocument(markdown).doc)).toBe(markdown)
  })

  test("コードブロックの meta (title など) を保つ", () => {
    const markdown = fixtures.コード
    expect(documentToMarkdown(markdownToDocument(markdown).doc)).toBe(markdown)
  })
})

describe("編集したときの書き戻し", () => {
  const original = [
    "\n冒頭の段落  ",
    "改行あり",
    "",
    "* アスタリスクの箇条書き",
    "* 2 つめ",
    "",
    "",
    "## 見出し",
    "",
    "変更する段落",
    "",
    "```js",
    "const x = 1",
    "```",
    "",
  ].join("\n")

  function edit(
    markdown: string,
    change: (content: JSONContent[]) => JSONContent[],
  ) {
    const parsed = markdownToDocument(markdown)
    const doc = { ...parsed.doc, content: change(parsed.doc.content ?? []) }
    return documentToMarkdown(doc, { sourceMap: parsed.sourceMap })
  }

  test("変更したブロックだけが書き換わる", () => {
    const result = edit(original, (content) =>
      content.map((node) =>
        node.type === "paragraph" && node.content?.[0]?.text === "変更する段落"
          ? {
              ...node,
              content: [{ type: "text", text: "変更した段落" }],
            }
          : node,
      ),
    )
    expect(result).toBe(original.replace("変更する段落", "変更した段落"))
  })

  test("ブロックを足しても前後は元のまま", () => {
    const result = edit(original, (content) => [
      ...content.slice(0, 2),
      { type: "paragraph", content: [{ type: "text", text: "追加" }] },
      ...content.slice(2),
    ])
    expect(result).toBe(
      original.replace("\n\n\n## 見出し", "\n\n追加\n\n## 見出し"),
    )
  })

  test("ブロックを消すと間の空行も 1 つにまとまる", () => {
    const result = edit(original, (content) =>
      content.filter((node) => node.type !== "heading"),
    )
    expect(result).toBe(original.replace("\n\n\n## 見出し\n\n", "\n\n"))
  })

  test("隣に新しい箇条書きを足しても 1 つにくっつかない", async () => {
    const markdown = "- a\n- b\n"
    const parsed = markdownToDocument(markdown)
    const list = parsed.doc.content?.[0]
    if (!list) throw new Error("no list")
    const doc = { type: "doc", content: [list, list] }
    const result = documentToMarkdown(doc, { sourceMap: parsed.sourceMap })
    expect(result).toBe("- a\n- b\n\n* a\n* b\n")
    expect(await html(result)).toBe(
      await html("- a\n- b\n\n<!---->\n\n- a\n- b\n"),
    )
  })

  test("空の文書は空文字列", () => {
    expect(
      documentToMarkdown({ type: "doc", content: [{ type: "paragraph" }] }),
    ).toBe("")
    expect(markdownToDocument("").doc).toEqual({
      type: "doc",
      content: [{ type: "paragraph" }],
    })
  })

  test("末尾に空段落が足されても値は変わらない", () => {
    const parsed = markdownToDocument(original)
    const doc = {
      ...parsed.doc,
      content: [...(parsed.doc.content ?? []), { type: "paragraph" }],
    }
    expect(documentToMarkdown(doc, { sourceMap: parsed.sourceMap })).toBe(
      original,
    )
  })
})

describe("生の Markdown として残すブロック", () => {
  test("HTML や参照リンクは rawMarkdown として元の文字列のまま残る", async () => {
    const markdown =
      '<div align="center">html</div>\n\n[参照][ref]\n\n[ref]: https://example.com\n'
    const parsed = markdownToDocument(markdown)
    expect(parsed.rawBlocks.map((block) => block.type)).toEqual([
      "html",
      "paragraph",
      "definition",
    ])
    expect(await html(documentToMarkdown(parsed.doc))).toBe(
      await html(markdown),
    )
  })

  test("rawMarkdown ノードは中身をそのまま出す", () => {
    expect(
      blockToMarkdown({
        type: "rawMarkdown",
        attrs: { source: "<b>そのまま</b>" },
      }),
    ).toBe("<b>そのまま</b>")
  })
})
