import {
  type KeyboardEvent,
  type ReactNode,
  useMemo,
  useRef,
  useState,
} from "react"
import {
  PiCalendarBlankBold,
  PiCaretDownBold,
  PiCaretRightBold,
  PiCircleDashedBold,
  PiHashStraightBold,
  PiLinkSimpleBold,
  PiListBold,
  PiLockSimpleBold,
  PiPlusBold,
  PiTagBold,
  PiTextAlignLeftBold,
  PiToggleLeftBold,
} from "react-icons/pi"
import { Popover, StateBadge, TagChip } from "../../components/ui"
import type { PropertyDef } from "../../lib/schema"
import type { SlugCheck } from "../../lib/slug"
import type { PostState } from "../../lib/status"

const KIND_ICONS = {
  date: PiCalendarBlankBold,
  tags: PiTagBold,
  text: PiTextAlignLeftBold,
  longText: PiTextAlignLeftBold,
  number: PiHashStraightBold,
  boolean: PiToggleLeftBold,
  url: PiLinkSimpleBold,
  select: PiListBold,
} as const

/** textarea の高さを中身に合わせる */
export function autosize(element: HTMLTextAreaElement | null, maxRows = 0) {
  if (!element) return
  element.style.height = "auto"
  const lineHeight =
    Number.parseFloat(getComputedStyle(element).lineHeight) || 24
  const max = maxRows > 0 ? lineHeight * maxRows : Number.POSITIVE_INFINITY
  element.style.height = `${Math.min(element.scrollHeight, max)}px`
  element.style.overflowY = element.scrollHeight > max ? "auto" : "hidden"
}

type SlugProps =
  | {
      mode: "edit"
      value: string
      check: SlugCheck
      onChange: (value: string) => void
    }
  | { mode: "fixed"; value: string | null; reason: string }

type Props = {
  properties: PropertyDef[]
  data: Record<string, unknown>
  onChange: (field: string, value: unknown) => void
  state: PostState | null
  slug: SlugProps
  knownTags: string[]
  readOnly?: boolean
}

function Row({
  label,
  icon,
  children,
  hover = true,
  htmlFor,
}: {
  label: string
  icon: ReactNode
  children: ReactNode
  hover?: boolean
  htmlFor?: string
}) {
  return (
    <div className="ad-prop">
      <label className="ad-prop__name" htmlFor={htmlFor}>
        {icon}
        <span className="truncate">{label}</span>
      </label>
      <div className={`ad-prop__value ${hover ? "ad-prop__value--hover" : ""}`}>
        {children}
      </div>
    </div>
  )
}

export function Properties({
  properties,
  data,
  onChange,
  state,
  slug,
  knownTags,
  readOnly,
}: Props) {
  const [more, setMore] = useState(false)
  const primary = properties.filter((property) => !property.advanced)
  const advanced = properties.filter((property) => property.advanced)

  const field = (property: PropertyDef) => {
    const id = `prop-${property.slug}`
    const Icon = KIND_ICONS[property.kind]
    const value = data[property.slug]
    let input: ReactNode
    switch (property.kind) {
      case "date":
        input = (
          <input
            id={id}
            type="date"
            value={typeof value === "string" ? value : ""}
            disabled={readOnly}
            onChange={(event) => onChange(property.slug, event.target.value)}
          />
        )
        break
      case "tags":
        input = (
          <TagInput
            label={property.label}
            value={Array.isArray(value) ? (value as string[]) : []}
            choices={property.choices.length ? property.choices : knownTags}
            allowCreate={property.choices.length === 0}
            disabled={readOnly}
            onChange={(next) => onChange(property.slug, next)}
          />
        )
        break
      case "longText":
        input = (
          <textarea
            id={id}
            rows={1}
            placeholder="空"
            value={typeof value === "string" ? value : ""}
            disabled={readOnly}
            ref={(element) => autosize(element, 3)}
            onChange={(event) => {
              autosize(event.target, 3)
              onChange(property.slug, event.target.value)
            }}
          />
        )
        break
      case "number":
        input = (
          <input
            id={id}
            type="number"
            placeholder="空"
            value={typeof value === "number" ? value : ""}
            disabled={readOnly}
            onChange={(event) =>
              onChange(
                property.slug,
                event.target.value === "" ? null : Number(event.target.value),
              )
            }
          />
        )
        break
      case "boolean":
        input = (
          <input
            id={id}
            type="checkbox"
            className="!w-auto"
            checked={value === true}
            disabled={readOnly}
            onChange={(event) => onChange(property.slug, event.target.checked)}
          />
        )
        break
      case "select":
        input = (
          <select
            id={id}
            className="w-full bg-transparent"
            value={typeof value === "string" ? value : ""}
            disabled={readOnly}
            onChange={(event) => onChange(property.slug, event.target.value)}
          >
            <option value="">空</option>
            {property.choices.map((choice) => (
              <option key={choice} value={choice}>
                {choice}
              </option>
            ))}
          </select>
        )
        break
      default:
        input = (
          <input
            id={id}
            type={property.kind === "url" ? "url" : "text"}
            placeholder="空"
            value={typeof value === "string" ? value : ""}
            disabled={readOnly}
            onChange={(event) => onChange(property.slug, event.target.value)}
          />
        )
    }
    return (
      <Row
        key={property.slug}
        label={property.label + (property.required ? " *" : "")}
        icon={<Icon />}
        htmlFor={property.kind === "tags" ? undefined : id}
      >
        {input}
      </Row>
    )
  }

  return (
    <section className="ad-props" aria-label="プロパティ">
      {state ? (
        <Row label="状態" icon={<PiCircleDashedBold />} hover={false}>
          <StateBadge state={state} />
        </Row>
      ) : null}
      {primary.map(field)}
      <Row
        label="slug"
        icon={<PiLinkSimpleBold />}
        hover={slug.mode === "edit"}
        htmlFor="prop-slug"
      >
        {slug.mode === "edit" ? (
          <>
            <input
              id="prop-slug"
              value={slug.value}
              placeholder="20261114_my_post"
              aria-invalid={!slug.check.ok}
              aria-describedby="prop-slug-hint"
              spellCheck={false}
              onChange={(event) => slug.onChange(event.target.value)}
            />
            <span
              id="prop-slug-hint"
              className="ad-prop__hint"
              data-tone={slug.check.ok ? undefined : "error"}
            >
              {slug.check.ok
                ? "記事の URL になります (/articles/slug)。作成後は変更できません"
                : slug.check.message}
            </span>
          </>
        ) : (
          <span
            className="flex min-w-0 items-center gap-1.5 text-muted"
            title={slug.reason}
          >
            <PiLockSimpleBold className="shrink-0" aria-label={slug.reason} />
            <span className="truncate font-mono text-[13px]">
              {slug.value ?? "(なし)"}
            </span>
          </span>
        )}
      </Row>
      {advanced.length > 0 ? (
        <>
          <button
            type="button"
            className="ad-btn ad-btn--muted ad-btn--sm mt-1"
            aria-expanded={more}
            onClick={() => setMore((open) => !open)}
          >
            {more ? <PiCaretDownBold /> : <PiCaretRightBold />}
            {more ? "表示を減らす" : `さらに表示 (${advanced.length})`}
          </button>
          {more ? advanced.map(field) : null}
        </>
      ) : null}
    </section>
  )
}

function TagInput({
  label,
  value,
  choices,
  allowCreate,
  disabled,
  onChange,
}: {
  label: string
  value: string[]
  choices: string[]
  allowCreate: boolean
  disabled?: boolean
  onChange: (value: string[]) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [active, setActive] = useState(0)
  const button = useRef<HTMLButtonElement>(null)
  const anchor = useMemo(() => ({ kind: "element" as const, ref: button }), [])
  const trimmed = query.trim()
  const options = useMemo(() => {
    const q = trimmed.toLowerCase()
    return choices
      .filter((choice) => !value.includes(choice))
      .filter((choice) => !q || choice.toLowerCase().includes(q))
      .slice(0, 50)
  }, [choices, value, trimmed])
  const canCreate =
    allowCreate &&
    trimmed !== "" &&
    !value.includes(trimmed) &&
    !choices.includes(trimmed)
  const entries = [
    ...options.map((name) => ({ name, create: false })),
    ...(canCreate ? [{ name: trimmed, create: true }] : []),
  ]

  const add = (name: string) => {
    if (!name || value.includes(name)) return
    onChange([...value, name])
    setQuery("")
    setActive(0)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return
    if (event.key === "ArrowDown") {
      event.preventDefault()
      setActive((index) => Math.min(index + 1, entries.length - 1))
    } else if (event.key === "ArrowUp") {
      event.preventDefault()
      setActive((index) => Math.max(index - 1, 0))
    } else if (event.key === "Enter") {
      event.preventDefault()
      const entry = entries[active] ?? (canCreate ? { name: trimmed } : null)
      if (entry) add(entry.name)
    } else if (event.key === "Backspace" && query === "" && value.length > 0) {
      onChange(value.slice(0, -1))
    }
  }

  return (
    <div
      className="flex min-w-0 flex-wrap items-center gap-1"
      data-testid="tag-input"
    >
      {value.map((tag) => (
        <TagChip
          key={tag}
          name={tag}
          onRemove={
            disabled
              ? undefined
              : () => onChange(value.filter((other) => other !== tag))
          }
        />
      ))}
      {disabled ? null : (
        <button
          ref={button}
          type="button"
          className="ad-btn ad-btn--sm ad-btn--muted"
          aria-label={`${label}を追加`}
          onClick={() => setOpen(true)}
        >
          <PiPlusBold />
          {value.length === 0 ? "空" : null}
        </button>
      )}
      {open ? (
        <Popover
          anchor={anchor}
          onClose={() => setOpen(false)}
          label={`${label}を選ぶ`}
        >
          <input
            className="ad-input mb-1"
            placeholder="タグを検索・作成"
            aria-label="タグを検索・作成"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setActive(0)
            }}
            onKeyDown={onKeyDown}
          />
          <div
            role="listbox"
            aria-label="タグ"
            className="max-h-64 overflow-auto"
          >
            {entries.map((entry, index) => (
              <button
                key={`${entry.create}:${entry.name}`}
                type="button"
                role="option"
                aria-selected={index === active}
                data-active={index === active}
                className="ad-menu-item"
                onMouseEnter={() => setActive(index)}
                onClick={() => add(entry.name)}
              >
                {entry.create ? (
                  <span className="text-muted">作成:</span>
                ) : null}
                <TagChip name={entry.name} />
              </button>
            ))}
            {entries.length === 0 ? (
              <p className="px-2 py-2 text-[13px] text-muted">
                {trimmed
                  ? "該当するタグはありません"
                  : "タグ名を入力してください"}
              </p>
            ) : null}
          </div>
        </Popover>
      ) : null}
    </div>
  )
}
