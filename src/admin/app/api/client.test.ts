import { describe, expect, test } from "vitest"
import { ApiError, createApi, NetworkError } from "./client"

// リクエストの形を固定する。根拠:
// - パス: emdash/src/astro/integration/routes.ts の injectRoute
// - CSRF ヘッダー: emdash/src/astro/middleware/auth.ts (X-EmDash-Request: 1)
// - body: emdash/src/api/schemas/content.ts (contentUpdateBody / contentScheduleBody など)
//   と @emdash-cms/admin の src/lib/api/content.ts

type Call = { url: string; init: RequestInit }

function fakeApi(
  respond: (call: Call) => Response = () =>
    Response.json({ success: true, data: { item: { id: "x" }, _rev: "r2" } }),
) {
  const calls: Call[] = []
  const api = createApi(async (url, init = {}) => {
    const call = { url, init }
    calls.push(call)
    return respond(call)
  })
  const last = () => {
    const call = calls.at(-1)
    if (!call) throw new Error("リクエストがありません")
    const headers = new Headers(call.init.headers)
    return {
      url: call.url,
      method: call.init.method ?? "GET",
      headers,
      body:
        typeof call.init.body === "string"
          ? JSON.parse(call.init.body)
          : undefined,
    }
  }
  return { api, calls, last }
}

describe("リクエストの形", () => {
  test("すべてのリクエストに CSRF ヘッダーと same-origin の Cookie", async () => {
    const { api, calls } = fakeApi()
    await api.getPost("a")
    expect(new Headers(calls[0].init.headers).get("X-EmDash-Request")).toBe("1")
    expect(calls[0].init.credentials).toBe("same-origin")
  })

  test("記事の取得", async () => {
    const { api, last } = fakeApi()
    await api.getPost("01ABC")
    expect(last()).toMatchObject({
      url: "/_emdash/api/content/posts/01ABC",
      method: "GET",
    })
  })

  test("自動保存の PUT は data と _rev と skipRevision", async () => {
    const { api, last } = fakeApi()
    await api.updatePost("01ABC", {
      data: { title: "t" },
      _rev: "r1",
      skipRevision: true,
    })
    const request = last()
    expect(request.url).toBe("/_emdash/api/content/posts/01ABC")
    expect(request.method).toBe("PUT")
    expect(request.headers.get("Content-Type")).toBe("application/json")
    expect(request.body).toEqual({
      data: { title: "t" },
      _rev: "r1",
      skipRevision: true,
    })
  })

  test("新規作成は POST で data / slug / locale / translationOf", async () => {
    const { api, last } = fakeApi()
    await api.createPost({
      data: { title: "t" },
      slug: "20261114_a",
      locale: "en",
      translationOf: "01JA",
    })
    expect(last()).toMatchObject({
      url: "/_emdash/api/content/posts",
      method: "POST",
      body: {
        data: { title: "t" },
        slug: "20261114_a",
        locale: "en",
        translationOf: "01JA",
      },
    })
  })

  test.each([
    ["publish", "/publish", "POST", { _rev: "r1" }],
    ["unpublish", "/unpublish", "POST", { _rev: "r1" }],
    ["discardDraft", "/discard-draft", "POST", { _rev: "r1" }],
  ] as const)("%s", async (name, suffix, method, body) => {
    const { api, last } = fakeApi()
    await api[name]("01ABC", { _rev: "r1" })
    expect(last()).toMatchObject({
      url: `/_emdash/api/content/posts/01ABC${suffix}`,
      method,
      body,
    })
  })

  test("予約は scheduledAt (ISO 8601) と _rev、取り消しは DELETE", async () => {
    const { api, last } = fakeApi()
    await api.schedule("01ABC", "2030-01-01T00:00:00.000Z", { _rev: "r1" })
    expect(last()).toMatchObject({
      url: "/_emdash/api/content/posts/01ABC/schedule",
      method: "POST",
      body: { scheduledAt: "2030-01-01T00:00:00.000Z", _rev: "r1" },
    })
    await api.unschedule("01ABC")
    expect(last()).toMatchObject({
      url: "/_emdash/api/content/posts/01ABC/schedule",
      method: "DELETE",
    })
  })

  test("一覧は limit=100 でカーソルを辿って全件", async () => {
    let page = 0
    const { api, calls } = fakeApi(() => {
      page++
      return Response.json({
        success: true,
        data: {
          items: [{ id: `p${page}` }],
          nextCursor: page < 3 ? `c${page}` : undefined,
        },
      })
    })
    const items = await api.listAllPosts({ locale: "ja" })
    expect(items.map((item) => item.id)).toEqual(["p1", "p2", "p3"])
    expect(calls.map((call) => call.url)).toEqual([
      "/_emdash/api/content/posts?limit=100&locale=ja",
      "/_emdash/api/content/posts?limit=100&locale=ja&cursor=c1",
      "/_emdash/api/content/posts?limit=100&locale=ja&cursor=c2",
    ])
  })

  test("編集ロックの取得と解放 (token は解放時はクエリ)", async () => {
    const { api, last } = fakeApi()
    await api.acquireLock("01ABC", "tab-1")
    expect(last()).toMatchObject({
      url: "/_emdash/api/content/posts/01ABC/lock",
      method: "POST",
      body: { takeover: false, token: "tab-1" },
    })
    await api.releaseLock("01ABC", "tab-1", true)
    expect(last()).toMatchObject({
      url: "/_emdash/api/content/posts/01ABC/lock?token=tab-1",
      method: "DELETE",
    })
  })

  test("スキーマはフィールド付きで取る", async () => {
    const { api, last } = fakeApi(() =>
      Response.json({ success: true, data: { item: { fields: [] } } }),
    )
    await api.getSchema()
    expect(last().url).toBe(
      "/_emdash/api/schema/collections/posts?includeFields=true",
    )
  })

  test("リビジョンの一覧・取得・復元", async () => {
    const { api, last } = fakeApi(() =>
      Response.json({ success: true, data: { item: {}, items: [] } }),
    )
    await api.revisions("01ABC")
    expect(last().url).toBe(
      "/_emdash/api/content/posts/01ABC/revisions?limit=50",
    )
    await api.getRevision("01REV")
    expect(last().url).toBe("/_emdash/api/revisions/01REV")
    await api.restoreRevision("01REV")
    expect(last()).toMatchObject({
      url: "/_emdash/api/revisions/01REV/restore",
      method: "POST",
    })
  })

  test("メディアの alt 更新は PUT、検索は q", async () => {
    const { api, last } = fakeApi()
    await api.updateMedia("01MED", { alt: "説明" })
    expect(last()).toMatchObject({
      url: "/_emdash/api/media/01MED",
      method: "PUT",
      body: { alt: "説明" },
    })
    await api.listMedia({ q: "png" })
    expect(last().url).toBe("/_emdash/api/media?limit=100&q=png")
  })
})

describe("エラー", () => {
  test("409 CONFLICT は isConflict", async () => {
    const { api } = fakeApi(() =>
      Response.json(
        {
          success: false,
          error: { code: "CONFLICT", message: "version conflict" },
        },
        { status: 409 },
      ),
    )
    const error = await api.updatePost("a", { _rev: "old" }).catch((e) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect(error.isConflict).toBe(true)
    expect(error.isLocked).toBe(false)
  })

  test("ENTRY_LOCKED は isLocked で、持ち主が details に入る", async () => {
    const holder = {
      userId: "u2",
      userName: "他の人",
      acquiredAt: "",
      expiresAt: "",
    }
    const { api } = fakeApi(() =>
      Response.json(
        {
          success: false,
          error: { code: "ENTRY_LOCKED", message: "locked", details: holder },
        },
        { status: 409 },
      ),
    )
    const error = await api.updatePost("a", {}).catch((e) => e)
    expect(error.isLocked).toBe(true)
    expect(error.isConflict).toBe(false)
    expect(error.details).toEqual(holder)
  })

  test("通信できないときは NetworkError", async () => {
    const api = createApi(async () => {
      throw new TypeError("Failed to fetch")
    })
    await expect(api.getPost("a")).rejects.toBeInstanceOf(NetworkError)
  })
})
