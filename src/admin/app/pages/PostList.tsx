import { type ReactNode, useMemo, useState } from "react"
import {
  PiCaretDownBold,
  PiCaretUpBold,
  PiClockBold,
  PiFileDashedBold,
  PiFileTextBold,
  PiMagnifyingGlassBold,
  PiPencilSimpleLineBold,
  PiPlusBold,
  PiSquaresFourBold,
  PiTableBold,
  PiWarningBold,
} from "react-icons/pi"
import { Spinner, StateBadge, TagChip } from "../components/ui"
import { formatDateTime, LOCALE_LABELS } from "../lib/format"
import { listStashes, stashDiffers } from "../lib/stash"
import { type PostState, STATE_LABELS } from "../lib/status"
import { Link, navigate, useDocumentTitle } from "../router"
import { type PostRow, useAdmin } from "../store"

type SortKey = "title" | "state" | "date" | "editedAt" | "locale"
type View = "table" | "gallery"

const STATE_ORDER: Record<PostState, number> = {
  draft: 0,
  scheduled: 1,
  changed: 2,
  changed_scheduled: 3,
  published: 4,
}

export function StateIcon({ state }: { state: PostState }) {
  const label = STATE_LABELS[state]
  // 状態は隣に文字でも出すので、読み上げではアイコンを飛ばす (タイトルにはツールチップ)
  const props = {
    "aria-hidden": true,
    title: label,
    className: "shrink-0 text-muted",
  }
  if (state === "draft") return <PiFileDashedBold {...props} />
  if (state === "scheduled") return <PiClockBold {...props} />
  if (state === "changed" || state === "changed_scheduled") {
    return (
      <PiPencilSimpleLineBold {...props} className="shrink-0 text-accent" />
    )
  }
  return <PiFileTextBold {...props} />
}

function compare(a: PostRow, b: PostRow, key: SortKey): number {
  switch (key) {
    case "title":
      return a.title.localeCompare(b.title, "ja")
    case "state":
      return STATE_ORDER[a.state] - STATE_ORDER[b.state]
    case "date":
      return a.date.localeCompare(b.date)
    case "editedAt":
      return a.editedAt.localeCompare(b.editedAt)
    case "locale":
      return (a.item.locale ?? "").localeCompare(b.item.locale ?? "")
  }
}

function readView(): View {
  try {
    return localStorage.getItem("blog-admin-view") === "gallery"
      ? "gallery"
      : "table"
  } catch {
    return "table"
  }
}

export function PostList() {
  useDocumentTitle("記事")
  const { rows, loading, error, layout, reload } = useAdmin()
  const [view, setView] = useState<View>(readView)
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({
    key: "editedAt",
    desc: true,
  })
  const [query, setQuery] = useState("")
  const [stateFilter, setStateFilter] = useState("all")
  const [tagFilter, setTagFilter] = useState("")
  const [localeFilter, setLocaleFilter] = useState("all")

  const allTags = useMemo(
    () =>
      [...new Set(rows.flatMap((row) => row.tags))].sort((a, b) =>
        a.localeCompare(b, "ja"),
      ),
    [rows],
  )

  const visible = useMemo(() => {
    const q = query.trim().normalize("NFKC").toLowerCase()
    return rows
      .filter((row) => {
        if (stateFilter === "changed") {
          if (row.state !== "changed" && row.state !== "changed_scheduled") {
            return false
          }
        } else if (stateFilter === "published") {
          if (row.state === "draft" || row.state === "scheduled") return false
        } else if (stateFilter !== "all" && row.state !== stateFilter) {
          return false
        }
        if (tagFilter && !row.tags.includes(tagFilter)) return false
        if (localeFilter !== "all" && row.item.locale !== localeFilter) {
          return false
        }
        if (q) {
          const text =
            `${row.title} ${row.slug ?? ""} ${row.tags.join(" ")} ${String(row.data.description ?? "")}`
              .normalize("NFKC")
              .toLowerCase()
          if (!q.split(/\s+/).every((word) => text.includes(word))) return false
        }
        return true
      })
      .sort((a, b) => {
        const result = compare(a, b, sort.key)
        return (sort.desc ? -result : result) || b.date.localeCompare(a.date)
      })
  }, [rows, query, stateFilter, tagFilter, localeFilter, sort])

  // 端末にだけある書きかけ (サーバーに保存できなかったもの)
  const stashes = useMemo(() => {
    const byId = new Map(rows.map((row) => [row.item.id, row]))
    return listStashes().filter((entry) => {
      if (entry.key.startsWith("new:")) return true
      const row = byId.get(entry.key)
      return row ? stashDiffers(entry, row.data) : false
    })
  }, [rows])

  const changeView = (next: View) => {
    setView(next)
    try {
      localStorage.setItem("blog-admin-view", next)
    } catch {
      // 覚えられなくても切り替える
    }
  }

  const header = (key: SortKey, label: string, width?: string) => (
    <th
      style={width ? { width } : undefined}
      aria-sort={
        sort.key === key ? (sort.desc ? "descending" : "ascending") : undefined
      }
    >
      <button
        onClick={() =>
          setSort((current) => ({
            key,
            desc: current.key === key ? !current.desc : key !== "title",
          }))
        }
      >
        {label}
        {sort.key === key ? (
          sort.desc ? (
            <PiCaretDownBold size={11} />
          ) : (
            <PiCaretUpBold size={11} />
          )
        ) : null}
      </button>
    </th>
  )

  let body: ReactNode
  if (loading && rows.length === 0) body = <Spinner />
  else if (error) {
    body = (
      <div className="ad-callout mt-6" data-tone="danger">
        <PiWarningBold />
        <div>
          <p>記事を読み込めませんでした: {error}</p>
          <button className="ad-btn ad-btn--outline mt-2" onClick={reload}>
            再読み込み
          </button>
        </div>
      </div>
    )
  } else if (view === "table") {
    body = (
      <div className="overflow-x-auto">
        <table className="ad-table min-w-[760px]">
          <thead>
            <tr>
              {header("title", "タイトル")}
              {header("state", "状態", "170px")}
              {header("date", "公開日", "110px")}
              <th style={{ width: "22%" }}>タグ</th>
              {header("editedAt", "更新日時", "150px")}
              {header("locale", "言語", "80px")}
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => (
              <tr
                key={row.item.id}
                onClick={(event) => {
                  if ((event.target as HTMLElement).closest("a")) return
                  navigate(`/posts/${row.item.id}`)
                }}
              >
                <td>
                  <Link
                    to={`/posts/${row.item.id}`}
                    className="flex items-center gap-2 font-medium text-fg no-underline"
                  >
                    <StateIcon state={row.state} />
                    <span className="truncate">{row.title || "無題"}</span>
                  </Link>
                </td>
                <td>
                  <StateBadge state={row.state} />
                </td>
                <td className="text-muted">{row.date}</td>
                <td>
                  <div className="flex gap-1 overflow-hidden">
                    {row.tags.map((tag) => (
                      <TagChip key={tag} name={tag} />
                    ))}
                  </div>
                </td>
                <td className="text-muted">{formatDateTime(row.editedAt)}</td>
                <td className="text-muted">
                  {LOCALE_LABELS[row.item.locale ?? ""] ?? row.item.locale}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {visible.length === 0 ? (
          <p className="py-10 text-center text-muted">
            該当する記事はありません
          </p>
        ) : null}
      </div>
    )
  } else {
    body = (
      <div className="ad-gallery">
        {visible.map((row) => {
          const cover = layout.coverField
            ? String(row.data[layout.coverField] ?? "")
            : ""
          return (
            <Link
              key={row.item.id}
              to={`/posts/${row.item.id}`}
              className="ad-card no-underline"
            >
              {cover ? (
                <img
                  className="ad-card__cover"
                  src={cover}
                  alt=""
                  loading="lazy"
                />
              ) : (
                <div className="ad-card__cover" />
              )}
              <div className="grid gap-1.5 p-3">
                <span className="flex items-center gap-2 font-medium">
                  <StateIcon state={row.state} />
                  <span className="truncate">{row.title || "無題"}</span>
                </span>
                <span className="flex flex-wrap items-center gap-1 text-[12.5px] text-muted">
                  <StateBadge state={row.state} />
                  {row.date}
                  {row.item.locale === "en" ? " · EN" : ""}
                </span>
                <span className="flex flex-wrap gap-1">
                  {row.tags.slice(0, 4).map((tag) => (
                    <TagChip key={tag} name={tag} />
                  ))}
                </span>
              </div>
            </Link>
          )
        })}
      </div>
    )
  }

  return (
    <div className="ad-page">
      <h1 className="ad-page__title">記事</h1>
      <p className="mb-6 text-muted">
        {rows.length} 件 · 行をクリックすると編集画面を開きます
      </p>

      {stashes.length > 0 ? (
        <div className="ad-callout mb-4" data-tone="warning" role="status">
          <PiWarningBold />
          <div className="grid gap-1">
            <p>
              この端末にだけ保存されている書きかけが {stashes.length}{" "}
              件あります。開くと復元できます。
            </p>
            <div className="flex flex-wrap gap-1">
              {stashes.map((entry) => {
                const title =
                  String(entry.data[layout.titleField] ?? "") || "無題"
                const to = entry.key.startsWith("new:")
                  ? `/posts/new?locale=${entry.locale ?? "ja"}${entry.translationOf ? `&translationOf=${entry.translationOf}` : ""}`
                  : `/posts/${entry.key}`
                return (
                  <Link
                    key={entry.key}
                    to={to}
                    className="ad-btn ad-btn--sm ad-btn--outline"
                  >
                    {title}
                    <span className="text-faint">
                      {formatDateTime(new Date(entry.savedAt).toISOString())}
                    </span>
                  </Link>
                )
              })}
            </div>
          </div>
        </div>
      ) : null}

      <div className="mb-2 flex flex-wrap items-center gap-1">
        <div className="mr-2 flex">
          <button
            className="ad-btn"
            aria-pressed={view === "table"}
            data-active={view === "table"}
            onClick={() => changeView("table")}
          >
            <PiTableBold />
            テーブル
          </button>
          <button
            className="ad-btn"
            aria-pressed={view === "gallery"}
            onClick={() => changeView("gallery")}
          >
            <PiSquaresFourBold />
            ギャラリー
          </button>
        </div>
        <label className="sr-only" htmlFor="filter-state">
          状態で絞り込む
        </label>
        <select
          id="filter-state"
          className="ad-select !w-auto"
          value={stateFilter}
          onChange={(event) => setStateFilter(event.target.value)}
        >
          <option value="all">状態: すべて</option>
          <option value="draft">下書き</option>
          <option value="scheduled">予約</option>
          <option value="published">公開中</option>
          <option value="changed">未公開の変更あり</option>
        </select>
        <label className="sr-only" htmlFor="filter-tag">
          タグで絞り込む
        </label>
        <select
          id="filter-tag"
          className="ad-select !w-auto max-w-[180px]"
          value={tagFilter}
          onChange={(event) => setTagFilter(event.target.value)}
        >
          <option value="">タグ: すべて</option>
          {allTags.map((tag) => (
            <option key={tag} value={tag}>
              {tag}
            </option>
          ))}
        </select>
        <label className="sr-only" htmlFor="filter-locale">
          言語で絞り込む
        </label>
        <select
          id="filter-locale"
          className="ad-select !w-auto"
          value={localeFilter}
          onChange={(event) => setLocaleFilter(event.target.value)}
        >
          <option value="all">言語: すべて</option>
          <option value="ja">日本語</option>
          <option value="en">English</option>
        </select>
        <div className="relative ml-auto">
          <PiMagnifyingGlassBold className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-faint" />
          <input
            className="ad-input !w-56 pl-7"
            type="search"
            placeholder="検索"
            aria-label="記事を検索"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <Link to="/posts/new" className="ad-btn ad-btn--primary">
          <PiPlusBold />
          新規
        </Link>
      </div>
      {body}
    </div>
  )
}
