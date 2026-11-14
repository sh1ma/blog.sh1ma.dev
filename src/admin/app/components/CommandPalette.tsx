import { type ReactNode, useMemo, useState } from "react"
import {
  PiFileTextBold,
  PiGearSixBold,
  PiHashBold,
  PiImageSquareBold,
  PiMoonBold,
  PiNotePencilBold,
} from "react-icons/pi"
import { classicUrl } from "../../routes"
import { navigate } from "../router"
import { useAdmin } from "../store"
import type { ThemeChoice } from "../theme"
import { Dialog, StateBadge } from "./ui"

type Item = {
  key: string
  label: string
  detail?: string
  icon: ReactNode
  run: () => void
  extra?: ReactNode
}

function normalize(text: string) {
  return text.normalize("NFKC").toLowerCase()
}

/** ⌘K。記事をタイトル・slug・タグ・説明で探して開く。画面の移動やテーマの切り替えも */
export function CommandPalette({
  onClose,
  onTheme,
}: {
  onClose: () => void
  onTheme: (choice: ThemeChoice) => void
}) {
  const { rows } = useAdmin()
  const [query, setQuery] = useState("")
  const [active, setActive] = useState(0)

  const items = useMemo<Item[]>(() => {
    const q = normalize(query.trim())
    const go = (path: string) => () => {
      onClose()
      navigate(path)
    }
    const actions: Item[] = [
      {
        key: "new",
        label: "新しい記事",
        icon: <PiNotePencilBold />,
        run: go("/posts/new"),
      },
      {
        key: "list",
        label: "記事一覧",
        icon: <PiFileTextBold />,
        run: go("/"),
      },
      {
        key: "media",
        label: "メディア",
        icon: <PiImageSquareBold />,
        run: go("/media"),
      },
      { key: "tags", label: "タグ", icon: <PiHashBold />, run: go("/tags") },
      {
        key: "settings",
        label: "EmDash の設定",
        icon: <PiGearSixBold />,
        run: () => {
          window.location.href = classicUrl.settings
        },
      },
      {
        key: "theme-light",
        label: "テーマ: ライト",
        icon: <PiMoonBold />,
        run: () => {
          onTheme("light")
          onClose()
        },
      },
      {
        key: "theme-dark",
        label: "テーマ: ダーク",
        icon: <PiMoonBold />,
        run: () => {
          onTheme("dark")
          onClose()
        },
      },
      {
        key: "theme-system",
        label: "テーマ: OS に従う",
        icon: <PiMoonBold />,
        run: () => {
          onTheme("system")
          onClose()
        },
      },
    ]
    const posts: Item[] = [...rows]
      .sort((a, b) => b.editedAt.localeCompare(a.editedAt))
      .filter((row) => {
        if (!q) return true
        const haystack = normalize(
          [
            row.title,
            row.slug ?? "",
            row.tags.join(" "),
            String(row.data.description ?? ""),
          ].join(" "),
        )
        return q.split(/\s+/).every((word) => haystack.includes(word))
      })
      .slice(0, 30)
      .map((row) => ({
        key: row.item.id,
        label: row.title || "無題",
        detail: `${row.item.locale === "en" ? "EN · " : ""}${row.slug ?? ""}`,
        icon: <PiFileTextBold />,
        run: go(`/posts/${row.item.id}`),
        extra: <StateBadge state={row.state} />,
      }))
    const matchedActions = q
      ? actions.filter((action) => normalize(action.label).includes(q))
      : []
    return [...posts, ...matchedActions]
  }, [rows, query, onClose, onTheme])

  const clamped = Math.min(active, Math.max(0, items.length - 1))

  return (
    <Dialog title="検索" onClose={onClose} className="bwa-palette">
      <input
        className="bwa-palette__input -mx-5 -mt-2 w-[calc(100%+2.5rem)]"
        placeholder="記事を検索… (タイトル・slug・タグ)"
        value={query}
        aria-label="記事を検索"
        aria-controls="palette-results"
        aria-activedescendant={
          items[clamped] ? `palette-${items[clamped].key}` : undefined
        }
        role="combobox"
        aria-expanded="true"
        onChange={(event) => {
          setQuery(event.target.value)
          setActive(0)
        }}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return
          if (event.key === "ArrowDown") {
            event.preventDefault()
            setActive((clamped + 1) % Math.max(1, items.length))
          } else if (event.key === "ArrowUp") {
            event.preventDefault()
            setActive((clamped - 1 + items.length) % Math.max(1, items.length))
          } else if (event.key === "Enter") {
            event.preventDefault()
            items[clamped]?.run()
          }
        }}
      />
      <div
        id="palette-results"
        role="listbox"
        className="mt-2 max-h-[50vh] overflow-auto"
      >
        {items.length === 0 ? (
          <p className="px-2 py-6 text-center text-muted">見つかりません</p>
        ) : null}
        {items.map((item, index) => (
          <button
            key={item.key}
            id={`palette-${item.key}`}
            role="option"
            aria-selected={index === clamped}
            className="bwa-menu-item"
            data-active={index === clamped}
            onMouseEnter={() => setActive(index)}
            onClick={item.run}
          >
            {item.icon}
            <span className="min-w-0 flex-1 truncate">{item.label}</span>
            {item.detail ? (
              <span className="bwa-menu-item__hint bwa-hide-sm max-w-[40%] truncate">
                {item.detail}
              </span>
            ) : null}
            {item.extra}
          </button>
        ))}
      </div>
    </Dialog>
  )
}
