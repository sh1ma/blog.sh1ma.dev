import {
  type AnchorHTMLAttributes,
  type MouseEvent,
  useEffect,
  useSyncExternalStore,
} from "react"
import { ADMIN_BASE } from "../routes"

// 小さなルーター。画面は 5 種類しかないので history API を直接使う。
// パスは ADMIN_BASE (/_emdash/admin) からの相対で扱う。

export type Route =
  | { name: "list" }
  | { name: "editor"; id: string }
  | { name: "new"; locale: string; translationOf: string | null }
  | { name: "media" }
  | { name: "tags" }
  | { name: "notFound" }

const listeners = new Set<() => void>()

/** 画面を離れる前に呼ばれる。false を返すと遷移しない (未保存の確認など) */
let guard: (() => boolean) | null = null

export function setNavigationGuard(next: (() => boolean) | null) {
  guard = next
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  window.addEventListener("popstate", listener)
  return () => {
    listeners.delete(listener)
    window.removeEventListener("popstate", listener)
  }
}

const snapshot = () => window.location.pathname + window.location.search

export function useLocationKey() {
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}

export function adminHref(path: string) {
  return path === "/" ? ADMIN_BASE : `${ADMIN_BASE}${path}`
}

export function navigate(
  path: string,
  options: { replace?: boolean; force?: boolean } = {},
) {
  if (!options.force && guard && !guard()) return
  const href = adminHref(path)
  if (options.replace) window.history.replaceState(null, "", href)
  else window.history.pushState(null, "", href)
  for (const listener of listeners) listener()
  if (!options.replace) window.scrollTo(0, 0)
}

export function parseRoute(pathname: string, search: string): Route {
  let path = pathname.startsWith(ADMIN_BASE)
    ? pathname.slice(ADMIN_BASE.length)
    : pathname
  path = path.replace(/\/+$/, "") || "/"
  const params = new URLSearchParams(search)
  if (path === "/" || path === "/posts") return { name: "list" }
  if (path === "/media") return { name: "media" }
  if (path === "/tags") return { name: "tags" }
  if (path === "/posts/new") {
    const locale = params.get("locale")
    return {
      name: "new",
      locale: locale === "en" ? "en" : "ja",
      translationOf: params.get("translationOf"),
    }
  }
  const editor = /^\/posts\/([^/]+)$/.exec(path)
  if (editor) return { name: "editor", id: decodeURIComponent(editor[1]) }
  return { name: "notFound" }
}

export function useRoute(): Route {
  const key = useLocationKey()
  const index = key.indexOf("?")
  return parseRoute(
    index === -1 ? key : key.slice(0, index),
    index === -1 ? "" : key.slice(index),
  )
}

type LinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & { to: string }

/** 管理画面内のリンク。⌘クリック・中クリックは新しいタブ (ブラウザに任せる) */
export function Link({ to, onClick, ...rest }: LinkProps) {
  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(event)
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return
    }
    event.preventDefault()
    navigate(to)
  }
  return <a href={adminHref(to)} onClick={handleClick} {...rest} />
}

/** タブのタイトル */
export function useDocumentTitle(title: string) {
  useEffect(() => {
    document.title = title ? `${title} | 管理画面` : "管理画面"
  }, [title])
}

// 新規作成した記事は URL が /posts/new から /posts/<id> に変わる。そのときに
// 編集画面を作り直すと入力中のカーソルが飛ぶので、同じ key のまま使い続ける。
// 作ったあとにもう一度「新しい記事」を開いたら別の画面にするため、作るたびに世代を進める。
const editorAliases = new Map<string, string>()
let newGeneration = 0

export function newEditorKey(route: Extract<Route, { name: "new" }>) {
  return `new:${route.locale}:${route.translationOf ?? ""}:${newGeneration}`
}

/** 新規作成した記事 id を、作成に使った編集画面の key に結び付ける (navigate より前に呼ぶ) */
export function aliasEditor(id: string, key: string) {
  editorAliases.set(id, key)
  newGeneration++
}

export function editorKey(route: Route): string {
  if (route.name === "new") return newEditorKey(route)
  if (route.name === "editor") return editorAliases.get(route.id) ?? route.id
  return route.name
}
