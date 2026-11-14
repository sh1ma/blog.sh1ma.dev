import {
  type DragEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import {
  PiCopyBold,
  PiImageSquareBold,
  PiMagnifyingGlassBold,
  PiTrashBold,
  PiUploadSimpleBold,
  PiWarningBold,
} from "react-icons/pi"
import {
  altFromFilename,
  uploadMedia,
} from "../../../plugins/markdown-editor/media"
import { api } from "../api/client"
import type { MediaItem } from "../api/types"
import { formatBytes, formatDateTime } from "../lib/format"
import { Link } from "../router"
import { type PostRow, useAdmin } from "../store"
import { ConfirmDialog, Dialog, StateBadge } from "./ui"

type Upload = {
  key: string
  name: string
  progress: number
  error: string | null
}

/** その画像を使っている記事 (本文の Markdown かカバーに URL がある)。下書きも含む */
export function mediaUsage(
  rows: PostRow[],
  url: string,
  fields: { body: string; cover: string | null },
): PostRow[] {
  if (!url) return []
  return rows.filter((row) => {
    const body = String(row.data[fields.body] ?? "")
    const cover = fields.cover ? String(row.data[fields.cover] ?? "") : ""
    return body.includes(url) || cover === url
  })
}

function isImage(item: Pick<MediaItem, "mimeType">) {
  return item.mimeType.startsWith("image/")
}

async function copy(text: string) {
  await navigator.clipboard.writeText(text)
}

type Props = {
  mode: "page" | "picker"
  /** picker のとき: 選んだ / アップロードした画像を返す */
  onPick?: (item: Pick<MediaItem, "url" | "alt" | "filename">) => void
  /** picker のとき画像だけ出す */
  imagesOnly?: boolean
}

export function MediaLibrary({ mode, onPick, imagesOnly }: Props) {
  const { rows, layout, toast, access } = useAdmin()
  const [items, setItems] = useState<MediaItem[]>([])
  const [cursor, setCursor] = useState<string | undefined>()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState("")
  const [debounced, setDebounced] = useState("")
  const [uploads, setUploads] = useState<Upload[]>([])
  const [dragging, setDragging] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query.trim()), 250)
    return () => clearTimeout(timer)
  }, [query])

  const load = useCallback(
    async (more: boolean, after?: string) => {
      setLoading(true)
      try {
        const page = await api.listMedia({
          q: debounced || undefined,
          cursor: more ? after : undefined,
        })
        setItems((list) => (more ? [...list, ...page.items] : page.items))
        setCursor(page.nextCursor)
        setError(null)
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause))
      } finally {
        setLoading(false)
      }
    },
    [debounced],
  )

  useEffect(() => {
    void load(false)
  }, [load])

  const visible = useMemo(
    () => (imagesOnly ? items.filter(isImage) : items),
    [items, imagesOnly],
  )
  const selected = items.find((item) => item.id === selectedId) ?? null

  const uploadFiles = async (files: File[]) => {
    if (!access.canWrite || files.length === 0) return
    const entries = files.map((file, index) => ({
      key: `${Date.now()}-${index}-${file.name}`,
      name: file.name,
      progress: 0,
      error: null,
    }))
    setUploads((list) => [...entries, ...list])
    const update = (key: string, patch: Partial<Upload>) =>
      setUploads((list) =>
        list.map((entry) =>
          entry.key === key ? { ...entry, ...patch } : entry,
        ),
      )
    let last: { url: string; filename?: string; alt: string } | null = null
    // 1 つずつ送る (同時に送ると遅い回線で全部が遅れる)
    for (const [index, file] of files.entries()) {
      const key = entries[index].key
      try {
        const uploaded = await uploadMedia(file, {
          onProgress: (ratio) => update(key, { progress: ratio }),
        })
        update(key, { progress: 1 })
        last = {
          url: uploaded.url,
          filename: file.name,
          alt: altFromFilename(file.name),
        }
        setTimeout(
          () => setUploads((list) => list.filter((entry) => entry.key !== key)),
          1500,
        )
      } catch (cause) {
        update(key, {
          error: cause instanceof Error ? cause.message : String(cause),
        })
      }
    }
    await load(false)
    if (mode === "picker" && last && files.length === 1) {
      onPick?.({ url: last.url, alt: last.alt, filename: last.filename ?? "" })
    } else if (last) {
      toast(`${files.length} 件アップロードしました`)
    }
  }

  const onDrop = (event: DragEvent) => {
    event.preventDefault()
    setDragging(false)
    void uploadFiles(Array.from(event.dataTransfer.files))
  }

  return (
    <div
      className="ad-dropzone relative rounded-lg"
      data-active={dragging}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes("Files")) {
          event.preventDefault()
          setDragging(true)
        }
      }}
      onDragLeave={(event) => {
        if (event.currentTarget === event.target) setDragging(false)
      }}
      onDrop={onDrop}
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-48 flex-1">
          <PiMagnifyingGlassBold className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-faint" />
          <input
            className="ad-input pl-7"
            type="search"
            placeholder="ファイル名で検索"
            aria-label="メディアを検索"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <button
          className="ad-btn ad-btn--primary"
          onClick={() => fileInput.current?.click()}
          disabled={!access.canWrite}
        >
          <PiUploadSimpleBold />
          アップロード
        </button>
        <input
          ref={fileInput}
          type="file"
          multiple
          accept={imagesOnly ? "image/*" : undefined}
          hidden
          aria-label="アップロードするファイル"
          data-testid="media-file-input"
          onChange={(event) => {
            void uploadFiles(Array.from(event.target.files ?? []))
            event.target.value = ""
          }}
        />
      </div>
      <p className="mb-3 text-[12.5px] text-muted">
        ここにファイルをドラッグ&ドロップしてもアップロードできます (複数可)
      </p>

      {uploads.length > 0 ? (
        <ul className="mb-4 grid gap-2" aria-label="アップロード中">
          {uploads.map((upload) => (
            <li key={upload.key} className="grid gap-1">
              <span className="flex justify-between text-[13px]">
                <span className="truncate">{upload.name}</span>
                <span className={upload.error ? "text-danger" : "text-muted"}>
                  {upload.error ?? `${Math.round(upload.progress * 100)}%`}
                </span>
              </span>
              <div className="ad-progress">
                <div style={{ width: `${upload.progress * 100}%` }} />
              </div>
            </li>
          ))}
        </ul>
      ) : null}

      {error ? (
        <div className="ad-callout mb-3" data-tone="danger">
          <PiWarningBold />
          <p>メディアを読み込めませんでした: {error}</p>
        </div>
      ) : null}

      <div
        className={
          mode === "page" && selected
            ? "grid gap-6 md:grid-cols-[1fr_320px]"
            : ""
        }
      >
        <div>
          <div className="ad-media-grid">
            {visible.map((item) => (
              <button
                key={item.id}
                className="ad-media-tile"
                aria-pressed={item.id === selectedId}
                title={item.filename}
                onClick={() =>
                  mode === "picker"
                    ? onPick?.(item)
                    : setSelectedId(item.id === selectedId ? null : item.id)
                }
              >
                {isImage(item) ? (
                  <img
                    className="ad-media-tile__thumb"
                    src={item.url}
                    alt={item.alt ?? ""}
                    loading="lazy"
                  />
                ) : (
                  <span className="ad-media-tile__thumb grid place-items-center text-faint">
                    <PiImageSquareBold size={28} />
                  </span>
                )}
                <span className="grid gap-0.5 p-2">
                  <span className="truncate text-[13px] font-medium">
                    {item.filename}
                  </span>
                  <span className="truncate text-[12px] text-muted">
                    {[
                      formatBytes(item.size),
                      item.width && item.height
                        ? `${item.width}×${item.height}`
                        : "",
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                  <span className="text-[12px] text-faint">
                    {formatDateTime(item.createdAt)}
                  </span>
                </span>
              </button>
            ))}
          </div>
          {!loading && visible.length === 0 ? (
            <p className="py-10 text-center text-muted">
              {debounced ? "見つかりません" : "まだメディアがありません"}
            </p>
          ) : null}
          {loading ? (
            <p className="py-6 text-center text-muted" role="status">
              読み込み中…
            </p>
          ) : null}
          {cursor && !loading ? (
            <div className="mt-4 text-center">
              <button
                className="ad-btn ad-btn--outline"
                onClick={() => load(true, cursor)}
              >
                もっと見る
              </button>
            </div>
          ) : null}
        </div>
        {mode === "page" && selected ? (
          <MediaDetail
            key={selected.id}
            item={selected}
            usage={mediaUsage(rows, selected.url, {
              body: layout.bodyField,
              cover: layout.coverField,
            })}
            onChanged={(next) =>
              setItems((list) =>
                list.map((entry) =>
                  entry.id === next.id ? { ...entry, ...next } : entry,
                ),
              )
            }
            onDeleted={() => {
              setItems((list) =>
                list.filter((entry) => entry.id !== selected.id),
              )
              setSelectedId(null)
            }}
          />
        ) : null}
      </div>
    </div>
  )
}

function MediaDetail({
  item,
  usage,
  onChanged,
  onDeleted,
}: {
  item: MediaItem
  usage: PostRow[]
  onChanged: (item: MediaItem) => void
  onDeleted: () => void
}) {
  const { toast } = useAdmin()
  const [alt, setAlt] = useState(item.alt ?? "")
  const [saving, setSaving] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const markdown = `![${alt}](${item.url})`
  const absoluteUrl = new URL(item.url, window.location.origin).toString()

  const saveAlt = async () => {
    if (alt === (item.alt ?? "")) return
    setSaving(true)
    try {
      onChanged(await api.updateMedia(item.id, { alt }))
      toast("代替テキストを保存しました")
    } catch (cause) {
      toast(cause instanceof Error ? cause.message : String(cause), "error")
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    try {
      await api.deleteMedia(item.id)
      toast(`${item.filename} を削除しました`)
      onDeleted()
    } catch (cause) {
      toast(cause instanceof Error ? cause.message : String(cause), "error")
    }
  }

  return (
    <aside
      className="sticky top-4 grid h-fit gap-3 rounded-lg p-3 shadow-[0_0_0_1px_var(--admin-line)]"
      aria-label="メディアの詳細"
    >
      {isImage(item) ? (
        <img
          src={item.url}
          alt={item.alt ?? ""}
          className="max-h-64 w-full rounded-md bg-subtle object-contain"
        />
      ) : null}
      <div>
        <p className="font-medium break-all">{item.filename}</p>
        <p className="text-[12.5px] text-muted">
          {[
            item.mimeType,
            formatBytes(item.size),
            item.width && item.height ? `${item.width}×${item.height}` : "",
            formatDateTime(item.createdAt),
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </div>
      <label className="grid gap-1">
        <span className="text-[12.5px] text-muted">代替テキスト (alt)</span>
        <textarea
          className="ad-textarea"
          rows={2}
          value={alt}
          onChange={(event) => setAlt(event.target.value)}
          onBlur={saveAlt}
        />
      </label>
      <div className="flex flex-wrap gap-1">
        <button
          className="ad-btn ad-btn--outline ad-btn--sm"
          onClick={saveAlt}
          disabled={saving || alt === (item.alt ?? "")}
        >
          alt を保存
        </button>
        <button
          className="ad-btn ad-btn--outline ad-btn--sm"
          onClick={() =>
            copy(absoluteUrl).then(() => toast("URL をコピーしました"))
          }
        >
          <PiCopyBold />
          URL
        </button>
        <button
          className="ad-btn ad-btn--outline ad-btn--sm"
          onClick={() =>
            copy(markdown).then(() => toast("Markdown をコピーしました"))
          }
        >
          <PiCopyBold />
          ![alt](url)
        </button>
      </div>
      <div>
        <p className="mb-1 text-[12.5px] text-muted">
          使われている記事 ({usage.length})
        </p>
        {usage.length === 0 ? (
          <p className="text-[13px] text-faint">
            本文・カバーには見つかりません
          </p>
        ) : (
          <ul className="grid gap-1">
            {usage.map((row) => (
              <li
                key={row.item.id}
                className="flex items-center gap-2 text-[13px]"
              >
                <Link to={`/posts/${row.item.id}`} className="truncate text-fg">
                  {row.title || "無題"}
                </Link>
                <StateBadge state={row.state} />
              </li>
            ))}
          </ul>
        )}
      </div>
      <button
        className="ad-btn ad-btn--danger justify-self-start"
        onClick={() => setConfirmDelete(true)}
      >
        <PiTrashBold />
        削除
      </button>
      {confirmDelete ? (
        <ConfirmDialog
          title="メディアを削除"
          confirmLabel="削除する"
          danger
          onConfirm={() => {
            setConfirmDelete(false)
            void remove()
          }}
          onClose={() => setConfirmDelete(false)}
        >
          {usage.length > 0 ? (
            <div className="ad-callout mb-3" data-tone="danger">
              <PiWarningBold />
              <div>
                <p className="font-medium">
                  {usage.length}{" "}
                  件の記事で使われています。削除すると画像が表示されなくなります。
                </p>
                <ul className="mt-1 list-disc pl-5">
                  {usage.map((row) => (
                    <li key={row.item.id}>{row.title || "無題"}</li>
                  ))}
                </ul>
              </div>
            </div>
          ) : null}
          <p>「{item.filename}」を削除します。元に戻せません。</p>
        </ConfirmDialog>
      ) : null}
    </aside>
  )
}

/** 編集画面から開くメディア選択 (画像の挿入・カバー) */
export function MediaPickerDialog({
  title,
  onPick,
  onClose,
  allowUrl,
}: {
  title: string
  onPick: (item: { url: string; alt: string }) => void
  onClose: () => void
  /** URL を直接入力できる (カバー) */
  allowUrl?: boolean
}) {
  const [url, setUrl] = useState("")
  return (
    <Dialog title={title} onClose={onClose} wide>
      {allowUrl ? (
        <form
          className="mb-4 flex gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            if (url.trim()) onPick({ url: url.trim(), alt: "" })
          }}
        >
          <input
            className="ad-input"
            type="url"
            placeholder="https://… (URL を直接入力)"
            aria-label="画像の URL"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
          />
          <button className="ad-btn ad-btn--outline" type="submit">
            URL を使う
          </button>
        </form>
      ) : null}
      <MediaLibrary
        mode="picker"
        imagesOnly
        onPick={(item) =>
          onPick({
            url: item.url,
            alt: item.alt || altFromFilename(item.filename),
          })
        }
      />
    </Dialog>
  )
}
