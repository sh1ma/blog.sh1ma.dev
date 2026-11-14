import {
  lazy,
  type ReactNode,
  Suspense,
  useCallback,
  useEffect,
  useState,
} from "react"
import { PiSidebarSimpleBold } from "react-icons/pi"
import type { AdminAccess } from "../permissions"
import type { Me } from "./api/types"
import { CommandPalette } from "./components/CommandPalette"
import { Sidebar } from "./components/Sidebar"
import { Spinner } from "./components/ui"
import { PostList } from "./pages/PostList"
import { editorKey, Link, useRoute } from "./router"
import { AdminProvider } from "./store"
import { useTheme } from "./theme"

// 編集画面 (Tiptap) と、メディア・タグの画面は開いたときに読み込む
const PostEditor = lazy(async () => ({
  default: (await import("./pages/PostEditor")).PostEditor,
}))
const MediaPage = lazy(async () => ({
  default: (await import("./pages/MediaPage")).MediaPage,
}))
const TagsPage = lazy(async () => ({
  default: (await import("./pages/TagsPage")).TagsPage,
}))

const SIDEBAR_KEY = "blog-admin-sidebar-collapsed"

function readCollapsed() {
  try {
    if (localStorage.getItem(SIDEBAR_KEY) !== null) {
      return localStorage.getItem(SIDEBAR_KEY) === "1"
    }
  } catch {
    // 既定値にする
  }
  return window.innerWidth < 760
}

function Shell() {
  const route = useRoute()
  const theme = useTheme()
  const [collapsed, setCollapsed] = useState(readCollapsed)
  const [palette, setPalette] = useState(false)

  const toggleSidebar = useCallback(() => {
    setCollapsed((value) => {
      try {
        localStorage.setItem(SIDEBAR_KEY, value ? "0" : "1")
      } catch {
        // 覚えられなくても切り替える
      }
      return !value
    })
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey
      if (mod && event.key.toLowerCase() === "k") {
        event.preventDefault()
        setPalette((open) => !open)
      } else if (mod && event.key === "\\") {
        event.preventDefault()
        toggleSidebar()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [toggleSidebar])

  const closePalette = useCallback(() => setPalette(false), [])

  let page: ReactNode
  switch (route.name) {
    case "list":
      page = <PostList />
      break
    case "editor":
      page = <PostEditor key={editorKey(route)} route={route} />
      break
    case "new":
      page = <PostEditor key={editorKey(route)} route={route} />
      break
    case "media":
      page = <MediaPage />
      break
    case "tags":
      page = <TagsPage />
      break
    default:
      page = (
        <div className="bwa-page">
          <h1 className="bwa-page__title">ページが見つかりません</h1>
          <p className="mt-4">
            <Link to="/" className="text-accent">
              記事一覧へ
            </Link>
          </p>
        </div>
      )
  }

  return (
    <div className="bwa-shell">
      <Sidebar
        route={route}
        collapsed={collapsed}
        onToggle={toggleSidebar}
        onSearch={() => setPalette(true)}
        theme={theme.choice}
        resolvedTheme={theme.resolved}
        onTheme={theme.choose}
      />
      <main className="bwa-main">
        {collapsed ? (
          <button
            className="bwa-btn bwa-btn--icon bwa-btn--muted fixed top-2 left-2 z-30"
            onClick={toggleSidebar}
            aria-label="サイドバーを開く"
            title="サイドバーを開く (⌘\)"
          >
            <PiSidebarSimpleBold />
          </button>
        ) : null}
        <div data-sidebar-collapsed={collapsed} className="contents">
          <Suspense fallback={<Spinner />}>{page}</Suspense>
        </div>
      </main>
      {palette ? (
        <CommandPalette onClose={closePalette} onTheme={theme.choose} />
      ) : null}
    </div>
  )
}

export default function App({ me, access }: { me: Me; access: AdminAccess }) {
  return (
    <AdminProvider me={me} access={access}>
      <Shell />
    </AdminProvider>
  )
}
