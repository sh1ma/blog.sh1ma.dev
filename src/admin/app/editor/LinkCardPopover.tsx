import type { Editor } from "@tiptap/core"
import { NodeSelection, TextSelection } from "@tiptap/pm/state"
import { useEditorState } from "@tiptap/react"
import { useEffect, useMemo, useState, useSyncExternalStore } from "react"
import {
  PiArrowClockwiseBold,
  PiArrowSquareOutBold,
  PiLinkBold,
} from "react-icons/pi"
import { domainOf } from "../../../../lib/ogp-fetcher"
import { STANDALONE_URL_TEXT_RE } from "../../../../lib/standalone-url"
import { Popover } from "../components/ui"
import { formatDateTime } from "../lib/format"
import type { OgpStore, OgpView } from "../lib/ogp-store"
import { linkCardAt } from "./link-card-extension"

// 選択したリンクカードの操作 (URL の編集・普通のリンクにする・再取得・新しいタブで開く)。

type Selected = { pos: number; url: string; kind: "ogp" | "tweet" }

function statusText(view: OgpView): string {
  switch (view.status) {
    case "loading":
      return "OGP を読み込み中…"
    case "ok":
      if (view.source === "legacy") return "移行前から保存している OGP"
      return view.fetchedAt
        ? `${formatDateTime(new Date(view.fetchedAt).toISOString())} に取得`
        : "保存済みの OGP"
    case "failed":
      return `取得できませんでした: ${view.error}`
    case "error":
      return `問い合わせに失敗しました: ${view.error}`
  }
}

export function LinkCardPopover({
  editor,
  store,
}: {
  editor: Editor
  store: OgpStore
}) {
  const selected = useEditorState({
    editor,
    selector: ({ editor: current }): Selected | null => {
      const { selection } = current.state
      if (!(selection instanceof NodeSelection)) return null
      const card = linkCardAt(current.state, selection.from)
      return card ? { pos: card.pos, url: card.url, kind: card.kind } : null
    },
  })
  const key = selected ? `${selected.pos}:${selected.url}` : null
  const [dismissed, setDismissed] = useState<string | null>(null)
  const [url, setUrl] = useState("")

  useEffect(() => {
    if (selected) setUrl(selected.url)
  }, [selected])

  // カードの DOM を基準に置く。カードの上でのクリックでは閉じない
  const anchor = useMemo(() => {
    const dom = selected ? editor.view.nodeDOM(selected.pos) : null
    return {
      kind: "element" as const,
      ref: { current: dom instanceof HTMLElement ? dom : null },
    }
  }, [editor, selected])

  const ogpUrl = selected?.kind === "ogp" ? selected.url : ""
  const view = useSyncExternalStore(
    (listener) => (ogpUrl ? store.subscribe(ogpUrl, listener) : () => {}),
    () => (ogpUrl ? store.get(ogpUrl) : null),
  )

  if (!selected || !key || dismissed === key || !anchor.ref.current) {
    return null
  }

  const editable = editor.isEditable
  const next = url.trim()
  const valid = STANDALONE_URL_TEXT_RE.test(next)

  /** 段落の中身を (印付きの) 文字 1 つに置き換える */
  const replaceContent = (
    text: string,
    href: string,
    keepSelected: boolean,
  ) => {
    const { pos } = selected
    editor
      .chain()
      .focus()
      .command(({ tr, state }) => {
        const node = state.doc.nodeAt(pos)
        if (!node) return false
        const previous = node.firstChild?.marks.find(
          (mark) => mark.type.name === "link",
        )
        const link = state.schema.marks.link.create({
          href,
          // <url> / 裸の URL の書き方は変えない
          source: previous?.attrs.source ?? null,
        })
        tr.replaceWith(
          pos + 1,
          pos + node.nodeSize - 1,
          state.schema.text(text, [link]),
        )
        tr.setSelection(
          keepSelected
            ? NodeSelection.create(tr.doc, pos)
            : TextSelection.create(tr.doc, pos + 1 + text.length),
        )
        return true
      })
      .run()
  }

  const applyUrl = () => {
    if (!valid || next === selected.url) return
    replaceContent(next, next, true)
  }

  const toInlineLink = () => {
    const title =
      view?.status === "ok" && view.data.title !== selected.url
        ? view.data.title
        : domainOf(selected.url)
    replaceContent(title, selected.url, false)
    setDismissed(key)
  }

  return (
    <Popover
      anchor={anchor}
      onClose={() => setDismissed(key)}
      keepFocus
      className="bwa-linkcard-pop"
      label="リンクカード"
    >
      <div data-testid="link-card-popover">
        <form
          className="flex gap-1 p-1"
          onSubmit={(event) => {
            event.preventDefault()
            applyUrl()
          }}
        >
          <input
            className="bwa-input"
            type="url"
            aria-label="リンクカードの URL"
            value={url}
            readOnly={!editable}
            onChange={(event) => setUrl(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") editor.commands.focus()
            }}
          />
          {editable ? (
            <button
              className="bwa-btn bwa-btn--primary"
              type="submit"
              disabled={!valid || next === selected.url}
            >
              変更
            </button>
          ) : null}
        </form>
        {selected.kind === "ogp" && view ? (
          <p className="bwa-linkcard-pop__status" data-status={view.status}>
            {statusText(view)}
          </p>
        ) : null}
        <div className="bwa-linkcard-pop__actions">
          {selected.kind === "ogp" ? (
            <button
              type="button"
              className="bwa-menu-item"
              disabled={view?.status === "loading"}
              onClick={() => void store.refresh(selected.url)}
            >
              <PiArrowClockwiseBold />
              再取得
            </button>
          ) : null}
          <button
            type="button"
            className="bwa-menu-item"
            onClick={() =>
              window.open(selected.url, "_blank", "noopener,noreferrer")
            }
          >
            <PiArrowSquareOutBold />
            新しいタブで開く
          </button>
          {editable ? (
            <button
              type="button"
              className="bwa-menu-item"
              onClick={toInlineLink}
              title="カードではなく、文中のリンク ([タイトル](URL)) にする"
            >
              <PiLinkBold />
              普通のリンクにする
            </button>
          ) : null}
        </div>
      </div>
    </Popover>
  )
}
