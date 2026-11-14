import type { Editor } from "@tiptap/core"
import {
  type KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import {
  PiArrowSquareOutBold,
  PiArrowsOutLineHorizontalBold,
  PiClockCounterClockwiseBold,
  PiCopyBold,
  PiDotsThreeBold,
  PiEyeBold,
  PiImageBold,
  PiLockSimpleBold,
  PiMarkdownLogoBold,
  PiTranslateBold,
  PiTrashBold,
  PiWarningBold,
} from "react-icons/pi"
import { classicUrl } from "../../routes"
import { ApiError, api } from "../api/client"
import type {
  ContentItem,
  LockHolder,
  Revision,
  Translation,
} from "../api/types"
import { MediaPickerDialog } from "../components/MediaLibrary"
import { ConfirmDialog, Dialog, Popover, Spinner } from "../components/ui"
import { NotionEditor } from "../editor/NotionEditor"
import { Autosave, type SaveState } from "../lib/autosave"
import {
  articlePath,
  formatDateTime,
  LOCALE_LABELS,
  todayLocal,
} from "../lib/format"
import { initialData, missingRequired } from "../lib/schema"
import { suggestSlug, validateSlug } from "../lib/slug"
import {
  clearStash,
  readStash,
  type StashEntry,
  stashDiffers,
  writeStash,
} from "../lib/stash"
import { postState, wasEverPublished } from "../lib/status"
import {
  aliasEditor,
  editorKey,
  Link,
  navigate,
  type Route,
  setNavigationGuard,
  useDocumentTitle,
} from "../router"
import { useAdmin } from "../store"
import { autosize, Properties } from "./editor/Properties"
import { type PublishAction, PublishMenu } from "./editor/PublishMenu"
import { RevisionsPanel } from "./editor/RevisionsPanel"

type EditorRoute = Extract<Route, { name: "editor" | "new" }>
type Data = Record<string, unknown>

const LOCK_HEARTBEAT_MS = 2 * 60 * 1000

/** 値が変わったフィールドだけ取り出す (送るのは変えた項目だけ) */
export function diffData(base: Data, next: Data): Data {
  const diff: Data = {}
  for (const key of new Set([...Object.keys(base), ...Object.keys(next)])) {
    if (!(key in next)) continue
    if (JSON.stringify(base[key]) !== JSON.stringify(next[key]))
      diff[key] = next[key]
  }
  return diff
}

function saveLabel(state: SaveState, isNew: boolean): string {
  switch (state.kind) {
    case "idle":
      return isNew ? "未保存" : ""
    case "dirty":
      return "未保存の変更"
    case "waiting":
      return state.message
    case "saving":
      return "保存中…"
    case "saved":
      return "保存済み"
    case "offline":
      return "オフライン・端末に保存"
    case "conflict":
      return "別の場所で変更されました"
    case "locked":
      return "他の人が編集中"
    case "error":
      return `保存できませんでした (端末に保存): ${state.message}`
  }
}

function randomToken() {
  return Array.from(crypto.getRandomValues(new Uint8Array(12)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("")
}

function readFullWidth() {
  try {
    return localStorage.getItem("blog-admin-full-width") === "1"
  } catch {
    return false
  }
}

export function PostEditor({ route }: { route: EditorRoute }) {
  const { layout, rows, access, me, upsert, remove, toast } = useAdmin()
  const mountKey = useRef(editorKey(route)).current
  const isNewRoute = route.name === "new"
  const translationOf = route.name === "new" ? route.translationOf : null
  const newStashKey = `new:${route.name === "new" ? route.locale : ""}:${translationOf ?? ""}`

  const [item, setItem] = useState<ContentItem | null>(null)
  const itemRef = useRef<ContentItem | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const [data, setData] = useState<Data>({})
  const dataRef = useRef<Data>({})
  /** サーバーに保存済みの値 (差分の基準) */
  const baseRef = useRef<Data>({})
  const [slug, setSlug] = useState("")
  const slugRef = useRef("")
  const slugTouched = useRef(false)
  const [source, setSource] = useState<ContentItem | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const [saveState, setSaveState] = useState<SaveState>({ kind: "idle" })
  const autosaveRef = useRef<Autosave<Data> | null>(null)
  /** 直前の保存が自動保存か (続けての自動保存は前の自動保存の版を置き換える) */
  const lastAutoRef = useRef(false)
  const stashKeyRef = useRef(isNewRoute ? newStashKey : route.id)
  const [stashOffer, setStashOffer] = useState<StashEntry | null>(null)
  const [lockHolder, setLockHolder] = useState<LockHolder | null>(null)
  const tokenRef = useRef(randomToken())
  const [mode, setMode] = useState<"wysiwyg" | "source">("wysiwyg")
  const [fullWidth, setFullWidth] = useState(readFullWidth)
  const [busy, setBusy] = useState(false)
  const [dialog, setDialog] = useState<
    null | "revisions" | "delete" | "discard" | "cover" | "unpublish"
  >(null)
  const [moreOpen, setMoreOpen] = useState(false)
  const [translations, setTranslations] = useState<Translation[] | null>(null)
  const editorRef = useRef<Editor | null>(null)
  const titleRef = useRef<HTMLTextAreaElement>(null)
  const moreButton = useRef<HTMLButtonElement>(null)
  const moreAnchor = useMemo(
    () => ({ kind: "element" as const, ref: moreButton }),
    [],
  )

  const locale = item?.locale ?? (route.name === "new" ? route.locale : "ja")
  const state = item ? postState(item) : null
  const title = String(data[layout.titleField] ?? "")
  useDocumentTitle(title || "無題")

  const sameLocaleSlugs = useMemo(
    () =>
      rows
        .filter((row) => row.item.locale === locale && row.item.id !== item?.id)
        .map((row) => row.slug)
        .filter((value): value is string => Boolean(value)),
    [rows, locale, item?.id],
  )
  const slugCheck = useMemo(
    () => validateSlug(slug, sameLocaleSlugs),
    [slug, sameLocaleSlugs],
  )
  const slugCheckRef = useRef(slugCheck)
  slugCheckRef.current = slugCheck

  const readOnly = Boolean(
    item &&
      ((item.authorId !== me.id && !access.canEditAny) ||
        (!access.canPublish && item.status !== "draft")),
  )

  const setCurrentItem = useCallback((next: ContentItem) => {
    itemRef.current = next
    setItem(next)
  }, [])

  /** サーバーの値でエディタを置き換える (再読込・破棄・版の復元) */
  const applyServerData = useCallback((next: Data) => {
    baseRef.current = next
    dataRef.current = next
    setData(next)
    setReloadKey((key) => key + 1)
  }, [])

  const acquireLock = useCallback(async (id: string, takeover = false) => {
    try {
      const status = await api.acquireLock(id, tokenRef.current, takeover)
      setLockHolder(
        status.enabled && status.holder && !status.heldByCaller
          ? status.holder
          : null,
      )
    } catch {
      // ロックは補助。取れなくても編集は続ける (保存時にサーバーが判定する)
    }
  }, [])

  // --- 読み込み (開いたときに 1 回だけ。新規 → 作成済みに変わっても読み直さない)
  const start = async (cancelled: () => boolean) => {
    try {
      let initial: Data
      let rev: string | undefined
      if (route.name === "editor") {
        const result = await api.getPost(route.id)
        if (cancelled()) return
        setCurrentItem(result.item)
        initial = result.item.data
        rev = result._rev
        slugRef.current = result.item.slug ?? ""
        setSlug(slugRef.current)
        void acquireLock(result.item.id)
      } else if (translationOf) {
        const result = await api.getPost(translationOf)
        if (cancelled()) return
        setSource(result.item)
        initial = { ...result.item.data }
        // 対訳は同じ slug にする (URL は /en/articles/:slug)
        slugRef.current = result.item.slug ?? ""
        setSlug(slugRef.current)
        slugTouched.current = true
      } else {
        initial = initialData(layout, todayLocal())
      }
      baseRef.current = route.name === "editor" ? initial : {}
      dataRef.current = initial
      setData(initial)

      const stash = readStash(stashKeyRef.current)
      if (stash && (route.name === "new" || stashDiffers(stash, initial))) {
        setStashOffer(stash)
      }

      autosaveRef.current = new Autosave<Data>({
        initialRev: rev,
        delay: 1500,
        onState: setSaveState,
        isOnline: () => navigator.onLine,
        stash: {
          write: (snapshot) =>
            writeStash({
              key: stashKeyRef.current,
              savedAt: Date.now(),
              baseRev: autosaveRef.current?.rev,
              data: snapshot,
              slug: itemRef.current ? undefined : slugRef.current,
              locale: route.name === "new" ? route.locale : undefined,
              translationOf: translationOf ?? undefined,
            }),
          clear: () => clearStash(stashKeyRef.current),
        },
        blockedReason: (snapshot) => {
          if (itemRef.current) return null
          if (!String(snapshot[layout.titleField] ?? "").trim()) {
            return "タイトルを入力すると保存されます"
          }
          if (!slugCheckRef.current.ok) return "slug を決めると保存されます"
          return null
        },
        save: async (snapshot, { rev: currentRev, explicit, overrideLock }) => {
          const current = itemRef.current
          if (!current) {
            const created = await api.createPost({
              data: snapshot,
              slug: slugRef.current.trim(),
              locale: route.name === "new" ? route.locale : undefined,
              translationOf: translationOf ?? undefined,
            })
            clearStash(stashKeyRef.current)
            stashKeyRef.current = created.item.id
            baseRef.current = snapshot
            lastAutoRef.current = false
            setCurrentItem(created.item)
            upsert(created.item, new Date().toISOString())
            aliasEditor(created.item.id, mountKey)
            navigate(`/posts/${created.item.id}`, {
              replace: true,
              force: true,
            })
            void acquireLock(created.item.id)
            return { rev: created._rev }
          }
          const diff = diffData(baseRef.current, snapshot)
          if (Object.keys(diff).length === 0) return { rev: currentRev }
          const saved = await api.updatePost(current.id, {
            data: diff,
            _rev: currentRev,
            skipRevision: !explicit && lastAutoRef.current ? true : undefined,
            overrideLock: overrideLock || undefined,
          })
          lastAutoRef.current = !explicit
          baseRef.current = { ...baseRef.current, ...diff }
          setCurrentItem(saved.item)
          upsert(saved.item, new Date().toISOString())
          return { rev: saved._rev }
        },
      })
      setReady(true)
    } catch (error) {
      if (!cancelled())
        setLoadError(error instanceof Error ? error.message : String(error))
    }
  }
  const startRef = useRef(start)
  useEffect(() => {
    let cancelled = false
    void startRef.current(() => cancelled)
    return () => {
      cancelled = true
    }
  }, [])

  // 新規はすぐタイトルを書けるように (Notion と同じ)
  useEffect(() => {
    if (ready && !itemRef.current) titleRef.current?.focus()
  }, [ready])

  // --- 後片付け: 保存しきれていない分を送り、ロックを返す
  useEffect(() => {
    return () => {
      const autosave = autosaveRef.current
      if (autosave?.hasUnsaved) void autosave.flush(false)
      autosave?.dispose()
      const current = itemRef.current
      if (current)
        void api.releaseLock(current.id, tokenRef.current, true).catch(() => {})
    }
  }, [])

  // ロックを延長する (EmDash の lease は 7 分)
  useEffect(() => {
    if (!item?.id) return
    const id = item.id
    const timer = setInterval(() => void acquireLock(id), LOCK_HEARTBEAT_MS)
    const release = () => {
      void api.releaseLock(id, tokenRef.current, true).catch(() => {})
    }
    window.addEventListener("pagehide", release)
    return () => {
      clearInterval(timer)
      window.removeEventListener("pagehide", release)
    }
  }, [item?.id, acquireLock])

  // オンラインに戻ったら送り直す
  useEffect(() => {
    const online = () => autosaveRef.current?.retry()
    window.addEventListener("online", online)
    return () => window.removeEventListener("online", online)
  }, [])

  // ページを離れるときに未保存なら確認する
  useEffect(() => {
    const risky = () => {
      const autosave = autosaveRef.current
      if (!autosave) return false
      return (
        autosave.hasUnsaved ||
        ["conflict", "locked", "error", "offline", "waiting"].includes(
          autosave.state.kind,
        )
      )
    }
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!risky()) return
      event.preventDefault()
    }
    window.addEventListener("beforeunload", beforeUnload)
    setNavigationGuard(() => {
      const autosave = autosaveRef.current
      if (!autosave) return true
      if (
        ["conflict", "locked", "error", "waiting"].includes(autosave.state.kind)
      ) {
        return window.confirm(
          "保存されていない変更があります (この端末には残っています)。移動しますか？",
        )
      }
      if (autosave.hasUnsaved) void autosave.flush(false)
      return true
    })
    return () => {
      window.removeEventListener("beforeunload", beforeUnload)
      setNavigationGuard(null)
    }
  }, [])

  // ⌘S
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault()
        void autosaveRef.current?.flush(true)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [])

  // --- 値の変更
  const update = useCallback((field: string, value: unknown) => {
    const next = { ...dataRef.current, [field]: value }
    dataRef.current = next
    setData(next)
    autosaveRef.current?.change(next)
  }, [])

  // 新規: slug を触っていなければ公開日とタイトルから提案する
  const dateValue = layout.dateField ? String(data[layout.dateField] ?? "") : ""
  useEffect(() => {
    if (item || slugTouched.current || !ready) return
    const suggestion = suggestSlug(dateValue, title, sameLocaleSlugs)
    slugRef.current = suggestion
    setSlug(suggestion)
  }, [item, ready, dateValue, title, sameLocaleSlugs])

  const changeSlug = (value: string) => {
    slugTouched.current = true
    slugRef.current = value
    setSlug(value)
    autosaveRef.current?.change(dataRef.current)
  }

  const onBodyChange = useCallback(
    (markdown: string) => update(layout.bodyField, markdown),
    [update, layout.bodyField],
  )
  const onEditorReady = useCallback((editor: Editor | null) => {
    editorRef.current = editor
  }, [])
  const onEditorInfo = useCallback((message: string) => toast(message), [toast])
  const onEditorError = useCallback(
    (message: string) => toast(message, "error"),
    [toast],
  )
  const focusTitle = useCallback(() => {
    const element = titleRef.current
    if (!element) return
    element.focus()
    element.setSelectionRange(element.value.length, element.value.length)
  }, [])

  const onTitleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return
    if (
      event.key === "Enter" ||
      (event.key === "ArrowDown" && !event.shiftKey)
    ) {
      const element = event.currentTarget
      if (
        event.key === "ArrowDown" &&
        element.selectionStart !== element.value.length
      )
        return
      event.preventDefault()
      editorRef.current?.commands.focus("start")
    }
  }

  // --- 復元
  const restoreStash = () => {
    if (!stashOffer) return
    const next = { ...dataRef.current, ...stashOffer.data }
    if (!itemRef.current && typeof stashOffer.slug === "string") {
      slugTouched.current = true
      slugRef.current = stashOffer.slug
      setSlug(stashOffer.slug)
    }
    dataRef.current = next
    setData(next)
    setReloadKey((key) => key + 1)
    setStashOffer(null)
    autosaveRef.current?.change(next)
    toast("端末に保存されていた書きかけを復元しました")
  }

  // --- 衝突・ロック
  const resolveConflict = async (choice: "overwrite" | "reload") => {
    const current = itemRef.current
    const autosave = autosaveRef.current
    if (!current || !autosave) return
    try {
      const fresh = await api.getPost(current.id)
      setCurrentItem(fresh.item)
      lastAutoRef.current = false
      if (choice === "reload") {
        applyServerData(fresh.item.data)
        await autosave.resolveConflict("reload", fresh._rev)
        toast("最新の内容を読み込みました")
      } else {
        // 自分の値を全部送り直す (サーバーの値との差分を取る)
        baseRef.current = fresh.item.data
        await autosave.resolveConflict("overwrite", fresh._rev)
      }
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "error")
    }
  }

  // --- 公開・予約など
  const act = async (action: PublishAction) => {
    const autosave = autosaveRef.current
    if (!autosave) return
    await autosave.flush(false)
    const current = itemRef.current
    if (!current) {
      toast("先にタイトルと slug を入れて保存してください", "error")
      return
    }
    if (
      ["conflict", "locked", "error", "offline", "waiting"].includes(
        autosave.state.kind,
      )
    ) {
      toast("保存できていない変更があるため実行できません", "error")
      return
    }
    if (action.kind === "publish" || action.kind === "schedule") {
      const missing = missingRequired(layout, dataRef.current)
      if (missing.length > 0) {
        toast(`必須項目が空です: ${missing.join("、")}`, "error")
        return
      }
    }
    setBusy(true)
    try {
      const rev = autosave.rev
      let message = ""
      switch (action.kind) {
        case "publish":
          await api.publish(current.id, { _rev: rev })
          message = "公開しました"
          break
        case "schedule":
          await api.schedule(current.id, action.at, { _rev: rev })
          message = `${formatDateTime(action.at)} に公開を予約しました`
          break
        case "unschedule":
          await api.unschedule(current.id)
          message = "予約を取り消しました"
          break
        case "unpublish":
          await api.unpublish(current.id, { _rev: rev })
          message = "公開を取り消しました"
          break
        case "discard":
          await api.discardDraft(current.id, { _rev: rev })
          message = "未公開の変更を破棄しました"
          break
      }
      const fresh = await api.getPost(current.id)
      setCurrentItem(fresh.item)
      autosave.setRev(fresh._rev)
      lastAutoRef.current = false
      upsert(fresh.item, new Date().toISOString())
      if (action.kind === "discard") applyServerData(fresh.item.data)
      toast(message)
    } catch (error) {
      if (error instanceof ApiError && error.isConflict) {
        toast(
          "別の場所で変更されています。再読込してからやり直してください",
          "error",
        )
      } else {
        toast(error instanceof Error ? error.message : String(error), "error")
      }
    } finally {
      setBusy(false)
    }
  }

  const onPublishAction = (action: PublishAction) => {
    if (action.kind === "discard") setDialog("discard")
    else if (action.kind === "unpublish") setDialog("unpublish")
    else void act(action)
  }

  const preview = async () => {
    const current = itemRef.current
    if (!current) return
    // ポップアップを止められないよう、クリックの中でタブを開いてから URL を入れる
    const tab = window.open("about:blank", "_blank")
    try {
      await autosaveRef.current?.flush(false)
      const url =
        state === "published" && current.slug
          ? articlePath(current.slug, current.locale)
          : (await api.previewUrl(current.id)).url
      if (tab) {
        tab.opener = null
        tab.location.href = url
      } else window.open(url, "_blank")
    } catch (error) {
      tab?.close()
      toast(error instanceof Error ? error.message : String(error), "error")
    }
  }

  const restoreRevision = async (revision: Revision) => {
    const current = itemRef.current
    const autosave = autosaveRef.current
    if (!current || !autosave) return
    try {
      await autosave.flush(false)
      await api.restoreRevision(revision.id)
      const fresh = await api.getPost(current.id)
      setCurrentItem(fresh.item)
      autosave.setRev(fresh._rev)
      lastAutoRef.current = false
      applyServerData(fresh.item.data)
      upsert(fresh.item, new Date().toISOString())
      setDialog(null)
      toast(
        "この版を下書きにしました。公開するには「変更を公開」を押してください",
      )
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "error")
    }
  }

  const deletePost = async () => {
    const current = itemRef.current
    if (!current) return
    setBusy(true)
    try {
      autosaveRef.current?.dispose()
      await api.deletePost(current.id)
      clearStash(current.id)
      remove(current.id)
      toast(`「${title || "無題"}」を削除しました (EmDash のゴミ箱に移動)`)
      navigate("/", { force: true })
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), "error")
      setBusy(false)
    }
  }

  const openMore = async () => {
    setMoreOpen(true)
    const current = itemRef.current
    if (current && translations === null) {
      try {
        setTranslations((await api.translations(current.id)).translations)
      } catch {
        setTranslations([])
      }
    }
  }

  const switchMode = (next: "wysiwyg" | "source") => {
    setMoreOpen(false)
    if (next === mode) return
    // ソースから戻るときはその時点の Markdown で読み直す
    if (next === "wysiwyg") setReloadKey((key) => key + 1)
    setMode(next)
  }

  const toggleFullWidth = () => {
    setFullWidth((value) => {
      try {
        localStorage.setItem("blog-admin-full-width", value ? "0" : "1")
      } catch {
        // 覚えられなくても切り替える
      }
      return !value
    })
    setMoreOpen(false)
  }

  if (loadError) {
    return (
      <div className="ad-page">
        <div className="ad-callout mt-16" data-tone="danger">
          <PiWarningBold />
          <div>
            <p>記事を開けませんでした: {loadError}</p>
            <Link to="/" className="ad-btn ad-btn--outline mt-2">
              記事一覧へ
            </Link>
          </div>
        </div>
      </div>
    )
  }
  if (!ready) return <Spinner />

  const cover = layout.coverField ? String(data[layout.coverField] ?? "") : ""
  const otherLocale = locale === "en" ? "ja" : "en"
  const translation = translations?.find(
    (entry) => entry.locale === otherLocale && entry.id !== item?.id,
  )
  const slugFixedReason = item
    ? wasEverPublished(item)
      ? "公開済みの記事の slug は変更できません (URL が変わるため)"
      : "作成後の slug は変更できません。変えるときは EmDash の画面で"
    : "対訳は元の記事と同じ slug になります"

  return (
    <div className="min-h-screen" data-testid="post-editor">
      <header className="ad-topbar">
        <nav className="ad-crumbs" aria-label="パンくず">
          <Link to="/">記事</Link>
          <span aria-hidden="true">/</span>
          <span className="ad-crumbs__current">{title || "無題"}</span>
          {locale === "en" ? (
            <span className="ad-chip" data-color="gray">
              EN
            </span>
          ) : null}
        </nav>
        <span
          className="ad-save ad-hide-sm"
          data-kind={saveState.kind}
          role="status"
          data-testid="save-status"
        >
          {saveLabel(saveState, !item)}
        </span>
        {lockHolder ? (
          <span className="ad-save" data-kind="locked" title="編集ロック">
            <PiLockSimpleBold className="inline" />{" "}
            {lockHolder.userName ?? "他の人"}が編集中
          </span>
        ) : null}
        <button
          className="ad-btn ad-btn--muted"
          onClick={preview}
          disabled={!item}
          title="プレビューを新しいタブで開く"
        >
          <PiEyeBold />
          <span className="ad-hide-sm">プレビュー</span>
        </button>
        <PublishMenu
          state={state}
          scheduledAt={item?.scheduledAt ?? null}
          disabled={!item || readOnly}
          canPublish={access.canPublish}
          busy={busy}
          onAction={onPublishAction}
        />
        <button
          ref={moreButton}
          className="ad-btn ad-btn--icon ad-btn--muted"
          aria-label="その他の操作"
          aria-haspopup="menu"
          aria-expanded={moreOpen}
          onClick={() => (moreOpen ? setMoreOpen(false) : void openMore())}
        >
          <PiDotsThreeBold />
        </button>
        {moreOpen ? (
          <Popover
            anchor={moreAnchor}
            placement="bottom-end"
            onClose={() => setMoreOpen(false)}
            label="その他の操作"
            className="w-[280px]"
          >
            <div role="menu" aria-label="その他の操作">
              <div className="px-2 py-1.5">
                <div className="text-[12px] text-muted">slug</div>
                <div className="flex items-center gap-1">
                  <code className="min-w-0 flex-1 truncate text-[12.5px]">
                    {item?.slug ?? (slug || "(未設定)")}
                  </code>
                  {item?.slug ? (
                    <button
                      className="ad-btn ad-btn--icon ad-btn--sm ad-btn--muted"
                      aria-label="公開 URL をコピー"
                      title="公開 URL をコピー"
                      onClick={() => {
                        const url = new URL(
                          articlePath(item.slug ?? "", locale),
                          window.location.origin,
                        )
                        void navigator.clipboard
                          .writeText(url.toString())
                          .then(() => toast("URL をコピーしました"))
                      }}
                    >
                      <PiCopyBold />
                    </button>
                  ) : null}
                </div>
              </div>
              <div className="ad-menu-sep" />
              <button
                role="menuitem"
                className="ad-menu-item"
                disabled={!item}
                onClick={() => {
                  setMoreOpen(false)
                  setDialog("revisions")
                }}
              >
                <PiClockCounterClockwiseBold />
                リビジョン履歴
              </button>
              {item && translation ? (
                <button
                  role="menuitem"
                  className="ad-menu-item"
                  onClick={() => {
                    setMoreOpen(false)
                    navigate(`/posts/${translation.id}`)
                  }}
                >
                  <PiTranslateBold />
                  {LOCALE_LABELS[otherLocale]} 版を開く
                </button>
              ) : null}
              {item && translations && !translation && locale === "ja" ? (
                <button
                  role="menuitem"
                  className="ad-menu-item"
                  onClick={() => {
                    setMoreOpen(false)
                    navigate(`/posts/new?locale=en&translationOf=${item.id}`)
                  }}
                >
                  <PiTranslateBold />
                  English 版を作る
                </button>
              ) : null}
              <button
                role="menuitem"
                className="ad-menu-item"
                onClick={() =>
                  switchMode(mode === "wysiwyg" ? "source" : "wysiwyg")
                }
              >
                <PiMarkdownLogoBold />
                {mode === "wysiwyg"
                  ? "Markdown ソースで編集"
                  : "見たまま編集に戻る"}
              </button>
              <button
                role="menuitemcheckbox"
                className="ad-menu-item"
                onClick={toggleFullWidth}
                aria-checked={fullWidth}
              >
                <PiArrowsOutLineHorizontalBold />
                {fullWidth ? "標準の幅にする" : "全幅にする"}
              </button>
              {item ? (
                <a
                  role="menuitem"
                  className="ad-menu-item no-underline"
                  href={classicUrl.post(item.id)}
                >
                  <PiArrowSquareOutBold />
                  元の EmDash で開く
                </a>
              ) : null}
              <div className="ad-menu-sep" />
              <button
                role="menuitem"
                className="ad-menu-item ad-menu-item--danger"
                disabled={!item || busy}
                onClick={() => {
                  setMoreOpen(false)
                  setDialog("delete")
                }}
              >
                <PiTrashBold />
                削除
              </button>
            </div>
          </Popover>
        ) : null}
      </header>

      {stashOffer ? (
        <div className="mx-auto max-w-[740px] px-4 pt-2">
          <div className="ad-callout" data-tone="warning" role="alert">
            <PiWarningBold />
            <div className="grid gap-2">
              <p>
                この端末に保存された書きかけがあります (
                {formatDateTime(new Date(stashOffer.savedAt).toISOString())})。
                サーバーの内容と違います。
              </p>
              <div className="flex gap-1">
                <button
                  className="ad-btn ad-btn--primary ad-btn--sm"
                  onClick={restoreStash}
                >
                  復元する
                </button>
                <button
                  className="ad-btn ad-btn--outline ad-btn--sm"
                  onClick={() => {
                    clearStash(stashKeyRef.current)
                    setStashOffer(null)
                  }}
                >
                  破棄する
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
      {lockHolder ? (
        <div className="mx-auto max-w-[740px] px-4 pt-2">
          <div className="ad-callout" data-tone="warning" role="alert">
            <PiLockSimpleBold />
            <div className="grid gap-2">
              <p>
                {lockHolder.userName ?? "他の人"}が編集中です (
                {formatDateTime(lockHolder.acquiredAt)}{" "}
                から)。同時に編集すると上書きし合います。
              </p>
              <div>
                <button
                  className="ad-btn ad-btn--outline ad-btn--sm"
                  onClick={() => item && void acquireLock(item.id, true)}
                >
                  引き継いで編集する
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
      {readOnly ? (
        <div className="mx-auto max-w-[740px] px-4 pt-2">
          <div className="ad-callout" role="status">
            <PiLockSimpleBold />
            <p>この記事を編集する権限がありません (表示のみ)。</p>
          </div>
        </div>
      ) : null}
      {source ? (
        <div className="mx-auto max-w-[740px] px-4 pt-2">
          <div className="ad-callout" data-tone="accent" role="status">
            <PiTranslateBold />
            <p>
              「{String(source.data[layout.titleField] ?? "")}」の English
              版を作っています。内容は元の記事からコピーしてあります。
            </p>
          </div>
        </div>
      ) : null}

      {cover ? (
        <div className="ad-cover" data-testid="cover">
          <img src={cover} alt="カバー画像" />
          {readOnly ? null : (
            <div className="ad-cover__actions">
              <button className="ad-btn" onClick={() => setDialog("cover")}>
                カバーを変更
              </button>
              <button
                className="ad-btn"
                onClick={() =>
                  layout.coverField && update(layout.coverField, "")
                }
              >
                削除
              </button>
            </div>
          )}
        </div>
      ) : null}

      <div className="ad-doc" data-full={fullWidth}>
        <div className="ad-doc__inner">
          <div className="ad-title-area" data-has-cover={Boolean(cover)}>
            <div className="ad-title-tools">
              {!cover && layout.coverField && !readOnly ? (
                <button
                  className="ad-btn ad-btn--muted ad-btn--sm"
                  onClick={() => setDialog("cover")}
                >
                  <PiImageBold />
                  カバーを追加
                </button>
              ) : null}
            </div>
            <textarea
              ref={(element) => {
                titleRef.current = element
                autosize(element)
              }}
              className="ad-title"
              rows={1}
              placeholder="無題"
              aria-label="タイトル"
              value={title}
              readOnly={readOnly}
              onChange={(event) => {
                autosize(event.target)
                update(layout.titleField, event.target.value.replace(/\n/g, ""))
              }}
              onKeyDown={onTitleKeyDown}
            />
          </div>

          <Properties
            properties={layout.properties}
            data={data}
            onChange={update}
            state={state}
            knownTags={[...new Set(rows.flatMap((row) => row.tags))].sort(
              (a, b) => a.localeCompare(b, "ja"),
            )}
            readOnly={readOnly}
            slug={
              !item && !source
                ? {
                    mode: "edit",
                    value: slug,
                    check: slugCheck,
                    onChange: changeSlug,
                  }
                : {
                    mode: "fixed",
                    value: item?.slug ?? slug,
                    reason: slugFixedReason,
                  }
            }
          />

          {mode === "wysiwyg" ? (
            <NotionEditor
              markdown={String(data[layout.bodyField] ?? "")}
              reloadKey={reloadKey}
              onChange={onBodyChange}
              onReady={onEditorReady}
              onInfo={onEditorInfo}
              onError={onEditorError}
              onExitTop={focusTitle}
              readOnly={readOnly}
            />
          ) : (
            <textarea
              className="ad-source mt-2"
              aria-label="本文 (Markdown)"
              spellCheck={false}
              value={String(data[layout.bodyField] ?? "")}
              readOnly={readOnly}
              onChange={(event) => update(layout.bodyField, event.target.value)}
            />
          )}
        </div>
      </div>

      {saveState.kind === "conflict" ? (
        <Dialog
          title="別の場所で変更されました"
          onClose={() => {}}
          footer={
            <>
              <button
                className="ad-btn ad-btn--outline"
                onClick={() => void resolveConflict("reload")}
              >
                再読込する (この画面の変更を捨てる)
              </button>
              <button
                className="ad-btn ad-btn--primary"
                onClick={() => void resolveConflict("overwrite")}
              >
                上書きする
              </button>
            </>
          }
        >
          <p>
            この記事は開いたあとに別のタブや端末で保存されました。この画面の内容で上書きするか、最新の内容を読み込み直すかを選んでください。
          </p>
          <p className="mt-2 text-[13px] text-muted">
            この画面の変更はこの端末にも保存してあります。
          </p>
        </Dialog>
      ) : null}

      {saveState.kind === "locked" ? (
        <Dialog
          title="他の人が編集中です"
          onClose={() => {}}
          footer={
            <>
              <button
                className="ad-btn ad-btn--outline"
                onClick={() => void resolveConflict("reload")}
              >
                最新の内容を読み込む
              </button>
              <button
                className="ad-btn ad-btn--primary"
                onClick={() => void autosaveRef.current?.overrideLockAndSave()}
              >
                それでも保存する
              </button>
            </>
          }
        >
          <p>
            {saveState.holder?.userName ?? "他の人"}
            がこの記事の編集ロックを持っているため、保存されませんでした。
          </p>
        </Dialog>
      ) : null}

      {dialog === "revisions" && item ? (
        <RevisionsPanel
          item={item}
          bodyField={layout.bodyField}
          titleField={layout.titleField}
          onRestore={restoreRevision}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog === "delete" ? (
        <ConfirmDialog
          title="記事を削除"
          confirmLabel="削除する"
          danger
          busy={busy}
          onConfirm={() => void deletePost()}
          onClose={() => setDialog(null)}
        >
          <p>
            「{title || "無題"}」を削除します。EmDash のゴミ箱に移ります (EmDash
            の画面から元に戻せます)。
          </p>
          {state && state !== "draft" ? (
            <p className="mt-2 text-danger">
              この記事は公開中または予約中です。削除すると公開ページから消えます。
            </p>
          ) : null}
        </ConfirmDialog>
      ) : null}
      {dialog === "discard" ? (
        <ConfirmDialog
          title="未公開の変更を破棄"
          confirmLabel="破棄する"
          danger
          busy={busy}
          onConfirm={() => {
            setDialog(null)
            void act({ kind: "discard" })
          }}
          onClose={() => setDialog(null)}
        >
          <p>公開してからの変更をすべて捨てて、公開中の内容に戻します。</p>
        </ConfirmDialog>
      ) : null}
      {dialog === "unpublish" ? (
        <ConfirmDialog
          title="公開を取り消す"
          confirmLabel="取り消す"
          danger
          busy={busy}
          onConfirm={() => {
            setDialog(null)
            void act({ kind: "unpublish" })
          }}
          onClose={() => setDialog(null)}
        >
          <p>
            公開ページから記事が消え、下書きに戻ります。URL (slug)
            はそのまま残ります。
          </p>
        </ConfirmDialog>
      ) : null}
      {dialog === "cover" ? (
        <MediaPickerDialog
          title="カバー画像"
          allowUrl
          onClose={() => setDialog(null)}
          onPick={({ url }) => {
            setDialog(null)
            if (layout.coverField) update(layout.coverField, url)
          }}
        />
      ) : null}
    </div>
  )
}
