import { useMemo } from "react"
import {
  PiArrowSquareOutBold,
  PiFileTextBold,
  PiGearSixBold,
  PiHashBold,
  PiImageSquareBold,
  PiMagnifyingGlassBold,
  PiMoonBold,
  PiNotePencilBold,
  PiSidebarSimpleBold,
  PiSignOutBold,
  PiSunBold,
} from "react-icons/pi"
import { classicUrl, LOGIN_PATH } from "../../routes"
import { api } from "../api/client"
import { Link, type Route } from "../router"
import { useAdmin } from "../store"
import type { ThemeChoice } from "../theme"

type Props = {
  route: Route
  collapsed: boolean
  onToggle: () => void
  onSearch: () => void
  theme: ThemeChoice
  resolvedTheme: "light" | "dark"
  onTheme: (choice: ThemeChoice) => void
}

export function Sidebar({
  route,
  collapsed,
  onToggle,
  onSearch,
  resolvedTheme,
  onTheme,
}: Props) {
  const { rows, me } = useAdmin()
  const counts = useMemo(() => {
    const result = { draft: 0, scheduled: 0, published: 0 }
    for (const row of rows) {
      if (row.state === "draft") result.draft++
      else if (row.state === "scheduled") result.scheduled++
      else result.published++
    }
    return result
  }, [rows])
  const recent = useMemo(
    () =>
      [...rows]
        .sort((a, b) => b.editedAt.localeCompare(a.editedAt))
        .slice(0, 6),
    [rows],
  )

  const logout = async () => {
    try {
      await api.logout()
    } finally {
      window.location.href = LOGIN_PATH
    }
  }

  const current = (name: Route["name"]) =>
    route.name === name ? "page" : undefined

  return (
    <aside
      className="ad-sidebar"
      data-collapsed={collapsed}
      aria-label="サイドバー"
      aria-hidden={collapsed}
      inert={collapsed}
    >
      <div className="ad-sidebar__inner">
        <div className="mb-1 flex items-center gap-1 px-2 py-1">
          <span className="grid size-6 place-items-center rounded-md bg-accent text-[13px] font-bold text-white">
            s
          </span>
          <span className="flex-1 truncate font-semibold">blog.sh1ma.dev</span>
          <button
            className="ad-btn ad-btn--icon ad-btn--muted"
            onClick={onToggle}
            aria-label="サイドバーを閉じる"
            title="サイドバーを閉じる (⌘\)"
          >
            <PiSidebarSimpleBold />
          </button>
        </div>

        <button className="ad-nav-item" onClick={onSearch}>
          <PiMagnifyingGlassBold />
          <span className="ad-nav-item__label">検索</span>
          <span className="ad-kbd">⌘K</span>
        </button>
        <Link className="ad-nav-item" to="/posts/new">
          <PiNotePencilBold />
          <span className="ad-nav-item__label">新しい記事</span>
        </Link>

        <div className="ad-nav-section">ワークスペース</div>
        <Link className="ad-nav-item" to="/" aria-current={current("list")}>
          <PiFileTextBold />
          <span className="ad-nav-item__label">記事</span>
        </Link>
        <div className="mb-1 flex flex-wrap gap-x-2 pl-9 text-[12px] text-faint">
          <span>下書き {counts.draft}</span>
          <span>予約 {counts.scheduled}</span>
          <span>公開済み {counts.published}</span>
        </div>
        <Link
          className="ad-nav-item"
          to="/media"
          aria-current={current("media")}
        >
          <PiImageSquareBold />
          <span className="ad-nav-item__label">メディア</span>
        </Link>
        <Link className="ad-nav-item" to="/tags" aria-current={current("tags")}>
          <PiHashBold />
          <span className="ad-nav-item__label">タグ</span>
        </Link>

        <div className="ad-nav-section">最近編集した記事</div>
        {recent.map((row) => (
          <Link
            key={row.item.id}
            className="ad-nav-item"
            to={`/posts/${row.item.id}`}
            aria-current={
              route.name === "editor" && route.id === row.item.id
                ? "page"
                : undefined
            }
          >
            <PiFileTextBold />
            <span className="ad-nav-item__label">{row.title || "無題"}</span>
            {row.item.locale === "en" ? (
              <span className="ad-nav-item__count">EN</span>
            ) : null}
          </Link>
        ))}

        <div className="mt-auto pt-4">
          <a className="ad-nav-item" href={classicUrl.settings}>
            <PiGearSixBold />
            <span className="ad-nav-item__label">EmDash の設定</span>
          </a>
          <a className="ad-nav-item" href={classicUrl.dashboard}>
            <PiArrowSquareOutBold />
            <span className="ad-nav-item__label">元の EmDash 管理画面</span>
          </a>
          <button
            className="ad-nav-item"
            onClick={() => onTheme(resolvedTheme === "dark" ? "light" : "dark")}
          >
            {resolvedTheme === "dark" ? <PiSunBold /> : <PiMoonBold />}
            <span className="ad-nav-item__label">
              {resolvedTheme === "dark" ? "ライトにする" : "ダークにする"}
            </span>
          </button>
          <button className="ad-nav-item" onClick={logout}>
            <PiSignOutBold />
            <span className="ad-nav-item__label">ログアウト</span>
            <span className="ad-nav-item__count truncate">
              {me.name ?? me.email}
            </span>
          </button>
        </div>
      </div>
    </aside>
  )
}
