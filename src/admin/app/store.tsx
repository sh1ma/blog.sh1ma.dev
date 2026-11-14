import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import type { AdminAccess } from "../permissions"
import { api } from "./api/client"
import type { ContentItem, Me } from "./api/types"
import { buildLayout, type EditorLayout } from "./lib/schema"
import { type PostState, postState } from "./lib/status"
import { tagsOf } from "./lib/tags"

// 記事の一覧と、スキーマから作った画面の配置を全画面で共有する。
// 記事は 100 件程度なので最初に全部読む。
//
// 一覧 API (GET /content/posts) は公開中の列の値しか返さない (下書きリビジョンを重ねない。
// emdash/src/api/handlers/content.ts の handleContentList) ので、下書きのある記事だけ
// GET /revisions/:id で下書きを読んで重ねる。純正管理画面の編集画面と同じやり方。

export type PostRow = {
  item: ContentItem
  /** 下書きを重ねた値 */
  data: Record<string, unknown>
  slug: string | null
  state: PostState
  title: string
  date: string
  tags: string[]
  /** 最後に編集した時刻 (下書きの保存は updatedAt を変えないので、下書きの作成時刻と比べる) */
  editedAt: string
}

/** "2026-11-14 12:30:36" (SQLite の UTC) も ISO 8601 にそろえる */
export function toIso(value: string): string {
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) {
    return `${value.replace(" ", "T")}Z`
  }
  return value
}

function later(a: string, b: string) {
  return Date.parse(toIso(a)) >= Date.parse(toIso(b)) ? toIso(a) : toIso(b)
}

export function makeRow(
  item: ContentItem,
  layout: EditorLayout,
  overlay?: { data: Record<string, unknown>; createdAt: string },
): PostRow {
  const data: Record<string, unknown> = { ...item.data }
  let slug = item.slug
  if (overlay) {
    for (const [key, value] of Object.entries(overlay.data)) {
      if (key === "_slug" && typeof value === "string") slug = value
      else if (!key.startsWith("_")) data[key] = value
    }
  }
  return {
    item,
    data,
    slug,
    state: postState(item),
    title: String(data[layout.titleField] ?? ""),
    date: layout.dateField ? String(data[layout.dateField] ?? "") : "",
    tags: layout.tagsField ? tagsOf(data, layout.tagsField) : [],
    editedAt: overlay
      ? later(item.updatedAt, overlay.createdAt)
      : toIso(item.updatedAt),
  }
}

/** 同時に投げるリクエストの数を抑えて順に処理する */
async function mapLimit<T, R>(
  list: T[],
  limit: number,
  fn: (value: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(list.length)
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, list.length) }, async () => {
      while (next < list.length) {
        const index = next++
        results[index] = await fn(list[index])
      }
    }),
  )
  return results
}

type Toast = { id: number; text: string; tone: "info" | "error" }

type AdminContextValue = {
  me: Me
  access: AdminAccess
  layout: EditorLayout
  rows: PostRow[]
  loading: boolean
  error: string | null
  reload: () => Promise<void>
  /** 編集画面で保存・公開したときに一覧の行を差し替える (data は下書きを重ねた値) */
  upsert: (item: ContentItem, editedAt?: string) => void
  remove: (id: string) => void
  toast: (text: string, tone?: "info" | "error") => void
}

const AdminContext = createContext<AdminContextValue | null>(null)

export function useAdmin() {
  const value = useContext(AdminContext)
  if (!value) throw new Error("AdminProvider の外で使われています")
  return value
}

export function AdminProvider({
  me,
  access,
  children,
}: {
  me: Me
  access: AdminAccess
  children: ReactNode
}) {
  const [layout, setLayout] = useState(() => buildLayout(null))
  const layoutRef = useRef(layout)
  layoutRef.current = layout
  const [rows, setRows] = useState<PostRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [toasts, setToasts] = useState<Toast[]>([])

  const toast = useCallback((text: string, tone: "info" | "error" = "info") => {
    const id = Date.now() + Math.random()
    setToasts((list) => [...list, { id, text, tone }])
    setTimeout(
      () => setToasts((list) => list.filter((entry) => entry.id !== id)),
      tone === "error" ? 8000 : 4000,
    )
  }, [])

  const loadRows = useCallback(async (current: EditorLayout) => {
    const items = await api.listAllPosts()
    return mapLimit(items, 6, async (item) => {
      if (
        !item.draftRevisionId ||
        item.draftRevisionId === item.liveRevisionId
      ) {
        return makeRow(item, current)
      }
      try {
        const revision = await api.getRevision(item.draftRevisionId)
        return makeRow(item, current, revision)
      } catch {
        return makeRow(item, current)
      }
    })
  }, [])

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      setRows(await loadRows(layoutRef.current))
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setLoading(false)
    }
  }, [loadRows])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      let next = layoutRef.current
      if (access.canReadSchema) {
        try {
          next = buildLayout(await api.getSchema())
          if (!cancelled) setLayout(next)
        } catch {
          // 取れなければ既定の項目で続ける
        }
      }
      layoutRef.current = next
      if (!cancelled) await reload()
    })()
    return () => {
      cancelled = true
    }
  }, [access.canReadSchema, reload])

  const upsert = useCallback((item: ContentItem, editedAt?: string) => {
    setRows((list) => {
      const row = makeRow(item, layoutRef.current)
      if (editedAt) row.editedAt = editedAt
      const index = list.findIndex((entry) => entry.item.id === item.id)
      if (index === -1) return [row, ...list]
      const next = [...list]
      next[index] = row
      return next
    })
  }, [])

  const remove = useCallback((id: string) => {
    setRows((list) => list.filter((entry) => entry.item.id !== id))
  }, [])

  const value = useMemo(
    () => ({
      me,
      access,
      layout,
      rows,
      loading,
      error,
      reload,
      upsert,
      remove,
      toast,
    }),
    [me, access, layout, rows, loading, error, reload, upsert, remove, toast],
  )

  return (
    <AdminContext.Provider value={value}>
      {children}
      <div className="bwa-toasts" aria-live="polite">
        {toasts.map((entry) => (
          <div key={entry.id} className="bwa-toast" data-tone={entry.tone}>
            {entry.text}
          </div>
        ))}
      </div>
    </AdminContext.Provider>
  )
}
