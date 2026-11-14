import { readFile } from "node:fs/promises"
import { describe, expect, test, vi } from "vitest"
import type { ContentItem, SchemaField } from "../api/types"
import {
  buildLayout,
  DEFAULT_FIELDS,
  initialData,
  missingRequired,
} from "./schema"
import { filterCommands, SLASH_COMMANDS } from "./slash-commands"
import { asciiWords, slugPrefix, suggestSlug, validateSlug } from "./slug"
import { postState, wasEverPublished } from "./status"
import { tagColor } from "./tag-color"
import {
  aggregateTags,
  applyOperation,
  executeTagPlan,
  planTagChange,
  type TagPost,
} from "./tags"

const seed = JSON.parse(
  await readFile(
    new URL("../../../../seed/seed.json", import.meta.url),
    "utf8",
  ),
) as {
  collections: { slug: string; titleField: string; fields: SchemaField[] }[]
  content: { posts: { slug: string; locale: string }[] }
}

describe("slug", () => {
  const existing = [
    "20261114_first",
    "20260720_1_cloudflare_containers",
    "20260720_2_other",
  ]

  test("タイトルの英数字だけを snake_case に", () => {
    expect(asciiWords("Cloudflare R2 を macOS の Finder で")).toBe(
      "cloudflare_r2_macos_finder",
    )
    expect(asciiWords("ブログを始めました")).toBe("")
    expect(asciiWords("ＡＢＣ　１２３")).toBe("abc_123")
  })

  test("公開日の頭。同じ日があれば連番", () => {
    expect(slugPrefix("2026-11-15", existing)).toBe("20261115_")
    expect(slugPrefix("2026-11-14", existing)).toBe("20261114_2_")
    expect(slugPrefix("2026-07-20", existing)).toBe("20260720_3_")
    expect(slugPrefix("not a date", existing)).toBeNull()
  })

  test("提案", () => {
    expect(suggestSlug("2026-11-15", "Hello Astro 7", existing)).toBe(
      "20261115_hello_astro_7",
    )
    // 日本語だけのタイトルは頭だけ (続きを書いてもらう)
    expect(suggestSlug("2026-11-15", "日本語だけ", existing)).toBe("20261115_")
  })

  test("検証", () => {
    expect(validateSlug("20261115_hello", existing)).toEqual({ ok: true })
    expect(validateSlug("", existing).ok).toBe(false)
    expect(validateSlug("20261115_", existing)).toEqual({
      ok: false,
      message:
        "日付の後ろに英数字の名前を付けてください (例: 20261114_my_post)",
    })
    expect(validateSlug("20261115", existing).ok).toBe(false)
    expect(validateSlug("20261115_日本語", existing).ok).toBe(false)
    expect(validateSlug("20261115_Hello", existing).ok).toBe(false)
    expect(validateSlug("20261114_first", existing)).toEqual({
      ok: false,
      message: "同じ slug の記事がすでにあります",
    })
  })

  test("既存の全記事の slug は検証を通る形をしている", () => {
    for (const post of seed.content.posts) {
      expect(validateSlug(post.slug, []), post.slug).toEqual({ ok: true })
    }
  })
})

function item(partial: Partial<ContentItem>): ContentItem {
  return {
    id: "x",
    type: "posts",
    slug: "s",
    status: "draft",
    data: {},
    authorId: null,
    createdAt: "",
    updatedAt: "",
    publishedAt: null,
    scheduledAt: null,
    liveRevisionId: null,
    draftRevisionId: null,
    version: 1,
    locale: "ja",
    translationGroup: null,
    ...partial,
  }
}

describe("状態", () => {
  test.each([
    [{ status: "draft" }, "draft"],
    [{ status: "draft", draftRevisionId: "d" }, "draft"],
    [{ status: "scheduled", scheduledAt: "2030" }, "scheduled"],
    [{ status: "published", liveRevisionId: "l" }, "published"],
    [
      { status: "published", liveRevisionId: "l", draftRevisionId: "l" },
      "published",
    ],
    [
      { status: "published", liveRevisionId: "l", draftRevisionId: "d" },
      "changed",
    ],
    [
      {
        status: "published",
        liveRevisionId: "l",
        draftRevisionId: "d",
        scheduledAt: "2030",
      },
      "changed_scheduled",
    ],
  ] as const)("%o → %s", (partial, expected) => {
    expect(postState(item(partial))).toBe(expected)
  })

  test("公開を取り消しても publishedAt が残るので公開済み扱い (slug を固定)", () => {
    expect(wasEverPublished(item({ status: "draft" }))).toBe(false)
    expect(
      wasEverPublished(item({ status: "draft", publishedAt: "2026-11-14" })),
    ).toBe(true)
  })
})

describe("スキーマ → プロパティ欄", () => {
  test("seed の posts のフィールドから", () => {
    const posts = seed.collections.find((c) => c.slug === "posts")
    const layout = buildLayout(posts ?? null)
    expect(layout).toMatchObject({
      titleField: "title",
      bodyField: "markdown",
      coverField: "thumbnail",
      dateField: "published_date",
      tagsField: "tags",
      required: ["title", "published_date", "markdown"],
    })
    expect(
      layout.properties.map((p) => [p.slug, p.kind, p.label, p.advanced]),
    ).toEqual([
      ["description", "longText", "説明", false],
      ["published_date", "date", "公開日", false],
      ["priority", "number", "優先度", true],
      ["tags", "tags", "タグ", false],
    ])
  })

  test("スキーマが取れないときは既定値 (seed と同じ)", () => {
    expect(buildLayout(null)).toEqual(
      buildLayout({ fields: DEFAULT_FIELDS, titleField: "title" }),
    )
  })

  test("知らないフィールドも型に合わせて「さらに表示」に出す", () => {
    const layout = buildLayout({
      titleField: "title",
      fields: [
        ...DEFAULT_FIELDS,
        { slug: "featured", label: "Featured", type: "boolean" },
        {
          slug: "series",
          label: "Series",
          type: "select",
          options: { choices: ["a", { value: "b", label: "B" }] },
        },
      ],
    })
    expect(layout.properties.find((p) => p.slug === "featured")).toMatchObject({
      kind: "boolean",
      advanced: true,
    })
    expect(layout.properties.find((p) => p.slug === "series")).toMatchObject({
      kind: "select",
      choices: ["a", "b"],
    })
  })

  test("新規の初期値と必須チェック", () => {
    const layout = buildLayout(null)
    const data = initialData(layout, "2026-11-14")
    expect(data).toEqual({
      title: "",
      markdown: "",
      published_date: "2026-11-14",
      priority: 0,
      tags: [],
    })
    expect(missingRequired(layout, data)).toEqual(["タイトル", "本文"])
  })
})

describe("スラッシュコマンドの絞り込み", () => {
  const ids = (query: string) => filterCommands(query).map((c) => c.id)

  test("空なら全部", () => {
    expect(ids("")).toHaveLength(SLASH_COMMANDS.length)
  })
  test("日本語のラベル", () => {
    expect(ids("見出し")).toEqual(["heading1", "heading2", "heading3"])
    expect(ids("表")).toContain("table")
  })
  test("英語・Markdown 記法・ローマ字の別名", () => {
    expect(ids("h2")[0]).toBe("heading2")
    expect(ids("code")[0]).toBe("codeBlock")
    expect(ids("todo")).toEqual(["taskList"])
    expect(ids("warn")).toEqual(["alertWarning"])
    expect(ids("katex")).toEqual(["mathBlock"])
    expect(ids("gazou")).toEqual(["image"])
  })
  test("先頭一致を部分一致より前に", () => {
    const result = ids("list")
    expect(result.slice(0, 3)).toEqual([
      "bulletList",
      "orderedList",
      "taskList",
    ])
  })
  test("当たらなければ空", () => {
    expect(ids("zzzz")).toEqual([])
  })
})

describe("タグ", () => {
  const posts: TagPost[] = [
    {
      id: "a",
      title: "A",
      locale: "ja",
      state: "published",
      tags: ["Rust", "CLI"],
      date: "2026-01-01",
    },
    {
      id: "b",
      title: "B",
      locale: "en",
      state: "published",
      tags: ["rust"],
      date: "2026-02-01",
    },
    {
      id: "c",
      title: "C",
      locale: "ja",
      state: "changed",
      tags: ["Rust"],
      date: "2026-03-01",
    },
    {
      id: "d",
      title: "D",
      locale: "ja",
      state: "draft",
      tags: ["CLI", "rust"],
      date: "2026-04-01",
    },
    {
      id: "e",
      title: "E",
      locale: "ja",
      state: "scheduled",
      tags: [],
      date: "2026-05-01",
    },
  ]

  test("集計 (件数・言語別・最終使用日)", () => {
    const summary = aggregateTags(posts)
    expect(summary.map((s) => [s.name, s.count])).toEqual([
      ["CLI", 2],
      ["rust", 2],
      ["Rust", 2],
    ])
    const rust = summary.find((s) => s.name === "rust")
    expect(rust).toMatchObject({
      byLocale: { en: 1, ja: 1 },
      lastUsed: "2026-04-01",
      postIds: ["b", "d"],
    })
  })

  test("操作 (順番を保ち重複は除く)", () => {
    expect(
      applyOperation(["Rust", "CLI"], {
        kind: "rename",
        from: "Rust",
        to: "rust",
      }),
    ).toEqual(["rust", "CLI"])
    expect(
      applyOperation(["CLI", "rust", "Rust"], {
        kind: "merge",
        from: ["Rust"],
        into: "rust",
      }),
    ).toEqual(["CLI", "rust"])
    expect(
      applyOperation(["CLI", "rust"], { kind: "delete", tag: "CLI" }),
    ).toEqual(["rust"])
  })

  test("改名の計画: 影響する記事だけ、公開済みの扱いを状態で分ける", () => {
    const plan = planTagChange(posts, {
      kind: "rename",
      from: "Rust",
      to: "rust",
    })
    expect(plan.map((p) => [p.id, p.after, p.action])).toEqual([
      ["a", ["rust", "CLI"], "update_and_publish"],
      // 未公開の変更があるものは公開し直さない
      ["c", ["rust"], "update_draft_only"],
    ])
  })

  test("統合と削除の計画", () => {
    const merge = planTagChange(posts, {
      kind: "merge",
      from: ["Rust", "rust"],
      into: "Rust",
    })
    expect(merge.map((p) => [p.id, p.after, p.action])).toEqual([
      ["b", ["Rust"], "update_and_publish"],
      ["d", ["CLI", "Rust"], "update"],
    ])
    const remove = planTagChange(posts, { kind: "delete", tag: "CLI" })
    expect(remove.map((p) => [p.id, p.after])).toEqual([
      ["a", ["Rust"]],
      ["d", ["rust"]],
    ])
  })

  test("実行: 読み直した状態で公開し直すかを決め、失敗しても続ける", async () => {
    const stored: Record<string, ContentItem> = {
      a: item({
        id: "a",
        status: "published",
        liveRevisionId: "l",
        data: { tags: ["Rust", "CLI"] },
      }),
      // 計画のあとで未公開の変更ができた → 公開しない
      b: item({
        id: "b",
        status: "published",
        liveRevisionId: "l",
        draftRevisionId: "d",
        data: { tags: ["Rust"] },
      }),
      c: item({ id: "c", status: "draft", data: { tags: ["Rust"] } }),
    }
    const api = {
      getPost: vi.fn(async (id: string) => ({
        item: stored[id],
        _rev: `${id}-r1`,
      })),
      updatePost: vi.fn(async (id: string) => {
        if (id === "c") throw new Error("validation failed")
        return { item: stored[id], _rev: `${id}-r2` }
      }),
      publish: vi.fn(async (id: string) => ({
        item: stored[id],
        _rev: `${id}-r3`,
      })),
    }
    const op = { kind: "rename", from: "Rust", to: "rust" } as const
    const plan = ["a", "b", "c"].map((id) => ({
      id,
      title: id,
      locale: "ja",
      state: "published" as const,
      before: [],
      after: [],
      action: "update_and_publish" as const,
    }))
    const results = await executeTagPlan(api, plan, op, "tags")
    expect(api.updatePost).toHaveBeenCalledWith("a", {
      data: { tags: ["rust", "CLI"] },
      _rev: "a-r1",
    })
    expect(api.publish).toHaveBeenCalledTimes(1)
    expect(api.publish).toHaveBeenCalledWith("a", { _rev: "a-r2" })
    expect(results.get("a")).toEqual({
      status: "done",
      action: "update_and_publish",
      published: true,
    })
    expect(results.get("b")).toEqual({
      status: "done",
      action: "update_draft_only",
      published: false,
    })
    expect(results.get("c")).toEqual({
      status: "failed",
      message: "validation failed",
      updated: false,
    })
  })

  test("色はタグ名で決まる", () => {
    expect(tagColor("Rust")).toBe(tagColor("Rust"))
    expect(
      new Set(["a", "b", "c", "d", "e", "f", "g"].map(tagColor)).size,
    ).toBeGreaterThan(1)
  })
})
