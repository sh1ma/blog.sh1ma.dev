import type { OgpData } from "../../../../lib/ogp-fetcher"
import type { OgpLookup } from "../../../plugins/link-cards/service"

// 編集画面のリンクカードの OGP。URL ごとに 1 回だけ問い合わせて覚えておき、
// 同じ URL のカード (node view) が複数あっても 1 回で済ませる。

export type OgpView =
  | { status: "loading" }
  | {
      status: "ok"
      data: OgpData
      source: OgpLookup["source"]
      fetchedAt: number | null
    }
  /** サーバーが取得に失敗した (公開ページは URL だけのカードになる) */
  | { status: "failed"; error: string; retryAfter?: number }
  /** 問い合わせ自体が失敗した (通信・権限・回数制限) */
  | { status: "error"; error: string }

export type OgpApi = {
  get: (url: string) => Promise<OgpLookup>
  refresh: (url: string) => Promise<OgpLookup>
}

function toView(lookup: OgpLookup): OgpView {
  if (lookup.status === "ok" && lookup.data) {
    return {
      status: "ok",
      data: lookup.data,
      source: lookup.source,
      fetchedAt: lookup.fetchedAt,
    }
  }
  return {
    status: "failed",
    error: lookup.error ?? "OGP がありません",
    ...(lookup.retryAfter ? { retryAfter: lookup.retryAfter } : {}),
  }
}

export function createOgpStore(api: OgpApi) {
  const views = new Map<string, OgpView>()
  const listeners = new Map<string, Set<() => void>>()

  function set(url: string, view: OgpView) {
    views.set(url, view)
    for (const listener of listeners.get(url) ?? []) listener()
  }

  async function load(url: string, force: boolean) {
    set(url, { status: "loading" })
    try {
      set(url, toView(await (force ? api.refresh(url) : api.get(url))))
    } catch (error) {
      set(url, {
        status: "error",
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return {
    /** 今の状態。まだ問い合わせていなければ問い合わせを始める */
    get(url: string): OgpView {
      const view = views.get(url)
      if (view) return view
      void load(url, false)
      return views.get(url) ?? { status: "loading" }
    },
    subscribe(url: string, listener: () => void): () => void {
      let set = listeners.get(url)
      if (!set) {
        set = new Set()
        listeners.set(url, set)
      }
      set.add(listener)
      return () => {
        set.delete(listener)
      }
    },
    /** サーバーで取り直す */
    refresh(url: string): Promise<void> {
      return load(url, true)
    },
  }
}

export type OgpStore = ReturnType<typeof createOgpStore>
