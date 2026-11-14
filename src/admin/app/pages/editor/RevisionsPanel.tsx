import { useEffect, useState } from "react"
import { PiArrowCounterClockwiseBold, PiWarningBold } from "react-icons/pi"
import { api } from "../../api/client"
import type { ContentItem, Revision } from "../../api/types"
import { Dialog } from "../../components/ui"
import { formatDateTime } from "../../lib/format"
import { toIso } from "../../store"

// リビジョン履歴。EmDash は保存のたびに revisions に版を残す
// (自動保存は直前の自動保存の版を置き換える。skipRevision)。
// 「この版に戻す」は POST /revisions/:id/restore で、その版を今の下書きにする
// (公開中の内容は変わらない。公開するには「変更を公開」が要る)。

export function RevisionsPanel({
  item,
  bodyField,
  titleField,
  onRestore,
  onClose,
}: {
  item: ContentItem
  bodyField: string
  titleField: string
  onRestore: (revision: Revision) => Promise<void>
  onClose: () => void
}) {
  const [revisions, setRevisions] = useState<Revision[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Revision | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api
      .revisions(item.id)
      .then((result) => {
        setRevisions(result.items)
        setSelected(result.items[0] ?? null)
      })
      .catch((cause) =>
        setError(cause instanceof Error ? cause.message : String(cause)),
      )
  }, [item.id])

  const label = (revision: Revision) => {
    if (revision.id === item.liveRevisionId) return "公開中の版"
    if (revision.id === item.draftRevisionId) return "今の下書き"
    return null
  }

  return (
    <Dialog title="リビジョン履歴" onClose={onClose} wide>
      {error ? (
        <div className="bwa-callout" data-tone="danger">
          <PiWarningBold />
          <p>{error}</p>
        </div>
      ) : null}
      {revisions === null && !error ? (
        <p className="text-muted">読み込み中…</p>
      ) : null}
      {revisions?.length === 0 ? (
        <p className="text-muted">まだ版がありません</p>
      ) : null}
      {revisions && revisions.length > 0 ? (
        <div className="grid gap-4 md:grid-cols-[260px_1fr]">
          <ul
            className="grid max-h-[60vh] content-start gap-0.5 overflow-auto"
            aria-label="版の一覧"
          >
            {revisions.map((revision) => (
              <li key={revision.id}>
                <button
                  className="bwa-menu-item"
                  data-active={selected?.id === revision.id}
                  aria-pressed={selected?.id === revision.id}
                  onClick={() => setSelected(revision)}
                >
                  <span className="grid min-w-0">
                    <span>{formatDateTime(toIso(revision.createdAt))}</span>
                    <span className="truncate text-[12px] text-muted">
                      {[label(revision), revision.author?.name]
                        .filter(Boolean)
                        .join(" · ") || String(revision.data[titleField] ?? "")}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {selected ? (
            <div className="grid min-w-0 content-start gap-2">
              <div className="flex items-center justify-between gap-2">
                <h3 className="truncate text-[18px] font-semibold">
                  {String(selected.data[titleField] ?? "") || "無題"}
                </h3>
                <button
                  className="bwa-btn bwa-btn--primary shrink-0"
                  disabled={busy || selected.id === item.draftRevisionId}
                  onClick={async () => {
                    setBusy(true)
                    try {
                      await onRestore(selected)
                    } finally {
                      setBusy(false)
                    }
                  }}
                >
                  <PiArrowCounterClockwiseBold />
                  この版に戻す
                </button>
              </div>
              <p className="text-[12.5px] text-muted">
                戻すと、この版が今の下書きになります。公開中の内容は「変更を公開」するまで変わりません。
              </p>
              <pre className="max-h-[52vh] overflow-auto rounded-md bg-subtle p-3 font-mono text-[12.5px] whitespace-pre-wrap">
                {String(selected.data[bodyField] ?? "")}
              </pre>
            </div>
          ) : null}
        </div>
      ) : null}
    </Dialog>
  )
}
