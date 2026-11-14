import { type ReactNode, useMemo, useRef, useState } from "react"
import {
  PiArrowUUpLeftBold,
  PiCalendarCheckBold,
  PiCaretDownBold,
  PiClockBold,
  PiEyeSlashBold,
  PiGlobeBold,
  PiXBold,
} from "react-icons/pi"
import { Popover } from "../../components/ui"
import { formatDateTime, toDateTimeLocal } from "../../lib/format"
import type { PostState } from "../../lib/status"

export type PublishAction =
  | { kind: "publish" }
  | { kind: "schedule"; at: string }
  | { kind: "unschedule" }
  | { kind: "unpublish" }
  | { kind: "discard" }

type Props = {
  state: PostState | null
  scheduledAt: string | null
  disabled: boolean
  /** 公開できないロール */
  canPublish: boolean
  busy: boolean
  onAction: (action: PublishAction) => void
}

function primaryLabel(state: PostState | null) {
  switch (state) {
    case "changed":
      return "変更を公開"
    case "scheduled":
      return "予約済み"
    case "changed_scheduled":
      return "変更を予約済み"
    case "published":
      return "公開中"
    default:
      return "公開"
  }
}

/** 既定の予約日時: 明日の 9:00 (ローカル時刻) */
function defaultScheduleValue(scheduledAt: string | null) {
  if (scheduledAt) return toDateTimeLocal(new Date(scheduledAt))
  const date = new Date()
  date.setDate(date.getDate() + 1)
  date.setHours(9, 0, 0, 0)
  return toDateTimeLocal(date)
}

export function PublishMenu({
  state,
  scheduledAt,
  disabled,
  canPublish,
  busy,
  onAction,
}: Props) {
  const [open, setOpen] = useState(false)
  const [picker, setPicker] = useState(false)
  const [when, setWhen] = useState(() => defaultScheduleValue(scheduledAt))
  const button = useRef<HTMLButtonElement>(null)
  const anchor = useMemo(() => ({ kind: "element" as const, ref: button }), [])

  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
  const whenDate = new Date(when)
  const future =
    !Number.isNaN(whenDate.getTime()) && whenDate.getTime() > Date.now()

  const run = (action: PublishAction) => {
    setOpen(false)
    setPicker(false)
    onAction(action)
  }

  const isLive =
    state === "published" ||
    state === "changed" ||
    state === "changed_scheduled"
  const item = (
    label: string,
    action: PublishAction | "picker",
    icon: ReactNode,
    options: { danger?: boolean; hint?: string } = {},
  ) => (
    <button
      role="menuitem"
      className={`ad-menu-item ${options.danger ? "ad-menu-item--danger" : ""}`}
      onClick={() => {
        if (action === "picker") {
          setWhen(defaultScheduleValue(scheduledAt))
          setPicker(true)
        } else run(action)
      }}
    >
      {icon}
      <span className="grid">
        <span>{label}</span>
        {options.hint ? (
          <span className="text-[12px] text-muted">{options.hint}</span>
        ) : null}
      </span>
    </button>
  )

  return (
    <>
      <button
        ref={button}
        className={`ad-btn ${state === "draft" || state === "changed" || state === null ? "ad-btn--primary" : "ad-btn--outline"}`}
        disabled={disabled || busy || !canPublish}
        title={canPublish ? undefined : "公開する権限がありません"}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {state === "scheduled" || state === "changed_scheduled" ? (
          <PiClockBold />
        ) : (
          <PiGlobeBold />
        )}
        {busy ? "処理中…" : primaryLabel(state)}
        <PiCaretDownBold size={12} />
      </button>
      {open ? (
        <Popover
          anchor={anchor}
          placement="bottom-end"
          onClose={() => {
            setOpen(false)
            setPicker(false)
          }}
          label="公開"
          className="w-[300px]"
        >
          {picker ? (
            <form
              className="grid gap-2 p-2"
              onSubmit={(event) => {
                event.preventDefault()
                if (future)
                  run({ kind: "schedule", at: whenDate.toISOString() })
              }}
            >
              <label className="grid gap-1">
                <span className="text-[13px] font-medium">
                  {isLive ? "変更を公開する日時" : "公開する日時"}
                </span>
                <input
                  className="ad-input"
                  type="datetime-local"
                  value={when}
                  aria-label="予約日時"
                  onChange={(event) => setWhen(event.target.value)}
                />
              </label>
              <span className="text-[12px] text-muted">
                タイムゾーン: {timezone}
                {future ? "" : " · 未来の日時を選んでください"}
              </span>
              <div className="flex justify-end gap-1">
                <button
                  type="button"
                  className="ad-btn ad-btn--outline"
                  onClick={() => setPicker(false)}
                >
                  戻る
                </button>
                <button
                  type="submit"
                  className="ad-btn ad-btn--primary"
                  disabled={!future}
                >
                  予約する
                </button>
              </div>
            </form>
          ) : (
            <div role="menu" aria-label="公開">
              {scheduledAt ? (
                <p className="px-2 py-1.5 text-[12.5px] text-muted">
                  予約: {formatDateTime(scheduledAt)}
                </p>
              ) : null}
              {state === "draft" || state === null ? (
                <>
                  {item("今すぐ公開", { kind: "publish" }, <PiGlobeBold />)}
                  {item(
                    "日時を指定して公開…",
                    "picker",
                    <PiCalendarCheckBold />,
                  )}
                </>
              ) : null}
              {state === "scheduled" ? (
                <>
                  {item("今すぐ公開", { kind: "publish" }, <PiGlobeBold />)}
                  {item("予約日時を変更…", "picker", <PiCalendarCheckBold />)}
                  {item("予約を取り消す", { kind: "unschedule" }, <PiXBold />, {
                    hint: "下書きに戻ります",
                  })}
                </>
              ) : null}
              {state === "changed" ? (
                <>
                  {item("変更を公開", { kind: "publish" }, <PiGlobeBold />)}
                  {item("変更の公開を予約…", "picker", <PiCalendarCheckBold />)}
                  {item(
                    "未公開の変更を破棄",
                    { kind: "discard" },
                    <PiArrowUUpLeftBold />,
                    {
                      danger: true,
                      hint: "公開中の内容に戻します",
                    },
                  )}
                </>
              ) : null}
              {state === "changed_scheduled" ? (
                <>
                  {item(
                    "今すぐ変更を公開",
                    { kind: "publish" },
                    <PiGlobeBold />,
                  )}
                  {item("予約日時を変更…", "picker", <PiCalendarCheckBold />)}
                  {item("予約を取り消す", { kind: "unschedule" }, <PiXBold />, {
                    hint: "変更は下書きのまま残ります",
                  })}
                </>
              ) : null}
              {state === "published" ? (
                <p className="px-2 py-1.5 text-[13px] text-muted">
                  公開中です。編集すると「未公開の変更」になり、ここから公開できます。
                </p>
              ) : null}
              {isLive ? (
                <>
                  <div className="ad-menu-sep" />
                  {item(
                    "公開を取り消す",
                    { kind: "unpublish" },
                    <PiEyeSlashBold />,
                    {
                      danger: true,
                      hint: "公開ページから消えて下書きに戻ります",
                    },
                  )}
                </>
              ) : null}
            </div>
          )}
        </Popover>
      ) : null}
    </>
  )
}
