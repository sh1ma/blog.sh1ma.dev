import { describe, expect, it } from "vitest"
import type { OgpLookup } from "../../../plugins/link-cards/service"
import { createOgpStore } from "./ogp-store"

const ok = (url: string, title: string): OgpLookup => ({
  url,
  status: "ok",
  source: "fetched",
  data: { url, title, domain: "example.com" },
  fetchedAt: 1,
})

const tick = () => new Promise((resolve) => setTimeout(resolve, 0))

describe("createOgpStore", () => {
  it("URL ごとに 1 回だけ問い合わせ、終わったら購読者に知らせる", async () => {
    const asked: string[] = []
    const store = createOgpStore({
      get: async (url) => {
        asked.push(url)
        return ok(url, "Title")
      },
      refresh: async () => {
        throw new Error("unused")
      },
    })
    let notified = 0
    store.subscribe("https://example.com/", () => notified++)
    expect(store.get("https://example.com/")).toEqual({ status: "loading" })
    expect(store.get("https://example.com/")).toEqual({ status: "loading" })
    await tick()
    expect(store.get("https://example.com/")).toMatchObject({
      status: "ok",
      data: { title: "Title" },
    })
    expect(asked).toEqual(["https://example.com/"])
    expect(notified).toBeGreaterThan(0)
  })

  it("サーバーの取得失敗 (failed) と問い合わせの失敗 (error) を分ける", async () => {
    const store = createOgpStore({
      get: async (url) => {
        if (url.endsWith("/down"))
          throw new Error("サーバーに接続できませんでした")
        return {
          url,
          status: "failed",
          source: "stored",
          data: null,
          fetchedAt: 1,
          error: "HTTP 404",
          retryAfter: 2,
        }
      },
      refresh: async () => {
        throw new Error("unused")
      },
    })
    store.get("https://example.com/404")
    store.get("https://example.com/down")
    await tick()
    expect(store.get("https://example.com/404")).toEqual({
      status: "failed",
      error: "HTTP 404",
      retryAfter: 2,
    })
    expect(store.get("https://example.com/down")).toEqual({
      status: "error",
      error: "サーバーに接続できませんでした",
    })
  })

  it("refresh は取り直しの API を呼び、結果で置き換える", async () => {
    const store = createOgpStore({
      get: async (url) => ok(url, "Old"),
      refresh: async (url) => ok(url, "New"),
    })
    store.get("https://example.com/")
    await tick()
    const seen: string[] = []
    const unsubscribe = store.subscribe("https://example.com/", () =>
      seen.push(store.get("https://example.com/").status),
    )
    await store.refresh("https://example.com/")
    unsubscribe()
    expect(seen).toEqual(["loading", "ok"])
    expect(store.get("https://example.com/")).toMatchObject({
      data: { title: "New" },
    })
  })
})
