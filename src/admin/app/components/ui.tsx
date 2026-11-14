import {
  type CSSProperties,
  type ReactNode,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react"
import { createPortal } from "react-dom"
import { PiXBold } from "react-icons/pi"
import { type PostState, STATE_LABELS } from "../lib/status"
import { tagColor } from "../lib/tag-color"

export type Anchor =
  | { kind: "element"; ref: RefObject<HTMLElement | null> }
  | { kind: "rect"; rect: () => DOMRect | null }

type PopoverProps = {
  anchor: Anchor
  onClose: () => void
  children: ReactNode
  placement?: "bottom-start" | "bottom-end" | "top-start"
  className?: string
  label?: string
  /** フォーカスをポップオーバーに移さない (エディタの入力を続けるスラッシュメニューなど) */
  keepFocus?: boolean
}

function anchorRect(anchor: Anchor): DOMRect | null {
  return anchor.kind === "element"
    ? (anchor.ref.current?.getBoundingClientRect() ?? null)
    : anchor.rect()
}

/** 画面の端からはみ出さないように置くポップオーバー。外側クリック・Esc で閉じる */
export function Popover({
  anchor,
  onClose,
  children,
  placement = "bottom-start",
  className = "",
  label,
  keepFocus,
}: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [style, setStyle] = useState<CSSProperties>({ visibility: "hidden" })
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useLayoutEffect(() => {
    const place = () => {
      const rect = anchorRect(anchor)
      const box = ref.current?.getBoundingClientRect()
      if (!rect || !box) return
      const margin = 8
      let left = placement === "bottom-end" ? rect.right - box.width : rect.left
      let top =
        placement === "top-start" ? rect.top - box.height - 4 : rect.bottom + 4
      if (top + box.height > window.innerHeight - margin) {
        top = Math.max(margin, rect.top - box.height - 4)
      }
      if (top < margin) top = margin
      left = Math.min(left, window.innerWidth - box.width - margin)
      left = Math.max(margin, left)
      setStyle({ left, top })
    }
    place()
    window.addEventListener("resize", place)
    window.addEventListener("scroll", place, true)
    return () => {
      window.removeEventListener("resize", place)
      window.removeEventListener("scroll", place, true)
    }
  }, [anchor, placement])

  useEffect(() => {
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node
      if (ref.current?.contains(target)) return
      if (anchor.kind === "element" && anchor.ref.current?.contains(target)) {
        return
      }
      onCloseRef.current()
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation()
        onCloseRef.current()
      }
    }
    document.addEventListener("pointerdown", onPointer, true)
    document.addEventListener("keydown", onKey, true)
    return () => {
      document.removeEventListener("pointerdown", onPointer, true)
      document.removeEventListener("keydown", onKey, true)
    }
  }, [anchor])

  useEffect(() => {
    if (keepFocus) return
    const first = ref.current?.querySelector<HTMLElement>(
      "input, textarea, select, button:not(:disabled)",
    )
    first?.focus()
  }, [keepFocus])

  return createPortal(
    <div
      ref={ref}
      className={`ad-popover ${className}`}
      style={style}
      role="dialog"
      aria-label={label}
    >
      {children}
    </div>,
    document.body,
  )
}

type DialogProps = {
  title: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  wide?: boolean
  className?: string
}

export function Dialog({
  title,
  onClose,
  children,
  footer,
  wide,
  className = "",
}: DialogProps) {
  const ref = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const first = ref.current?.querySelector<HTMLElement>(
      "[data-autofocus], input, textarea, button:not([data-close])",
    )
    first?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation()
        onCloseRef.current()
      }
    }
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("keydown", onKey)
      previous?.focus?.()
    }
  }, [])
  return createPortal(
    <div
      className="ad-overlay"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        ref={ref}
        className={`ad-dialog ${wide ? "ad-dialog--wide" : ""} ${className}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="ad-dialog__header">
          <h2 className="ad-dialog__title">{title}</h2>
          <button
            className="ad-btn ad-btn--icon ad-btn--muted"
            onClick={onClose}
            aria-label="閉じる"
            data-close=""
          >
            <PiXBold />
          </button>
        </div>
        <div className="ad-dialog__body">{children}</div>
        {footer ? <div className="ad-dialog__footer">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  )
}

export function ConfirmDialog({
  title,
  children,
  confirmLabel,
  danger,
  busy,
  onConfirm,
  onClose,
}: {
  title: string
  children: ReactNode
  confirmLabel: string
  danger?: boolean
  busy?: boolean
  onConfirm: () => void
  onClose: () => void
}) {
  return (
    <Dialog
      title={title}
      onClose={onClose}
      footer={
        <>
          <button className="ad-btn ad-btn--outline" onClick={onClose}>
            キャンセル
          </button>
          <button
            className={`ad-btn ${danger ? "ad-btn--danger-solid" : "ad-btn--primary"}`}
            onClick={onConfirm}
            disabled={busy}
            data-autofocus=""
          >
            {confirmLabel}
          </button>
        </>
      }
    >
      {children}
    </Dialog>
  )
}

export function TagChip({
  name,
  onRemove,
}: {
  name: string
  onRemove?: () => void
}) {
  return (
    <span className="ad-chip" data-color={tagColor(name)} title={name}>
      {name}
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          aria-label={`タグ「${name}」を外す`}
        >
          <PiXBold size={10} />
        </button>
      ) : null}
    </span>
  )
}

export function StateBadge({ state }: { state: PostState }) {
  return (
    <span className="ad-state" data-state={state}>
      {STATE_LABELS[state]}
    </span>
  )
}

export function Spinner({ label = "読み込み中…" }: { label?: string }) {
  return (
    <p role="status" className="py-16 text-center text-muted">
      {label}
    </p>
  )
}
