import { type Editor, Extension, type Range } from "@tiptap/core"
import { Placeholder } from "@tiptap/extensions"
import { NodeSelection } from "@tiptap/pm/state"
import type { EditorView } from "@tiptap/pm/view"
import { EditorContent, useEditor, useEditorState } from "@tiptap/react"
import { BubbleMenu } from "@tiptap/react/menus"
import {
  type DragEvent as ReactDragEvent,
  type ReactNode,
  type Ref,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import {
  PiArrowDownBold,
  PiArrowUpBold,
  PiCheckSquareBold,
  PiCodeBlockBold,
  PiCodeBold,
  PiCopyBold,
  PiDotsSixVerticalBold,
  PiFunctionBold,
  PiImageBold,
  PiInfoBold,
  PiLightbulbBold,
  PiLinkBold,
  PiLinkSimpleBold,
  PiListBulletsBold,
  PiListNumbersBold,
  PiMinusBold,
  PiPlusBold,
  PiQuotesBold,
  PiSealWarningBold,
  PiSigmaBold,
  PiTableBold,
  PiTextBBold,
  PiTextHOneBold,
  PiTextHThreeBold,
  PiTextHTwoBold,
  PiTextItalicBold,
  PiTextStrikethroughBold,
  PiTextTBold,
  PiTrashBold,
  PiWarningBold,
  PiWarningOctagonBold,
} from "react-icons/pi"
import editorCss from "../../../plugins/markdown-editor/editor.css?inline"
import {
  markdownToDocument,
  type ParsedMarkdown,
} from "../../../plugins/markdown-editor/markdown"
import {
  altFromFilename,
  uploadMedia,
} from "../../../plugins/markdown-editor/media"
import {
  createEditorExtensions,
  type MathEditRequest,
  renderLatex,
} from "../../../plugins/markdown-editor/node-views"
import { createSerializer } from "../../../plugins/markdown-editor/serializer"
import { api } from "../api/client"
import { MediaPickerDialog } from "../components/MediaLibrary"
import { Dialog, Popover } from "../components/ui"
import { createOgpStore } from "../lib/ogp-store"
import {
  SLASH_COMMANDS,
  type SlashCommand,
  type SlashCommandId,
} from "../lib/slash-commands"
import {
  type CommandContext,
  convertBlock,
  deleteBlock,
  duplicateBlock,
  insertBlockBelow,
  moveBlock,
  runSlashCommand,
} from "./commands"
import { LinkCardPopover } from "./LinkCardPopover"
import { LinkCards } from "./link-card-extension"
import { createSlashExtension, type SlashState } from "./slash"

// 記事の本文を Notion のように書くエディタ。
// Markdown ⇄ 文書の変換・スキーマ・node view・アップロードは本文ウィジェット
// (src/plugins/markdown-editor) と共通。変換の性質も同じで、
// - 開いただけでは onChange を呼ばない (値を変えない)
// - 触っていないブロックは元の Markdown の文字列のまま書き戻す

export const COMMAND_ICONS: Record<SlashCommandId, ReactNode> = {
  paragraph: <PiTextTBold />,
  heading1: <PiTextHOneBold />,
  heading2: <PiTextHTwoBold />,
  heading3: <PiTextHThreeBold />,
  bulletList: <PiListBulletsBold />,
  orderedList: <PiListNumbersBold />,
  taskList: <PiCheckSquareBold />,
  blockquote: <PiQuotesBold />,
  alertNote: <PiInfoBold />,
  alertTip: <PiLightbulbBold />,
  alertImportant: <PiSealWarningBold />,
  alertWarning: <PiWarningBold />,
  alertCaution: <PiWarningOctagonBold />,
  codeBlock: <PiCodeBlockBold />,
  table: <PiTableBold />,
  horizontalRule: <PiMinusBold />,
  mathBlock: <PiSigmaBold />,
  image: <PiImageBold />,
  linkCard: <PiLinkSimpleBold />,
}

type Props = {
  /** 読み込む Markdown。reloadKey が変わったときだけ読み直す */
  markdown: string
  reloadKey: number
  onChange: (markdown: string) => void
  onReady?: (editor: Editor | null) => void
  onError?: (message: string) => void
  onInfo?: (message: string) => void
  /** 1 行目より上で ↑ を押したとき (タイトルへ戻る) */
  onExitTop?: () => void
  readOnly?: boolean
}

type MathRequest = { pos: number | null; latex: string; display: boolean }

function imageFiles(files: FileList | null | undefined): File[] {
  return Array.from(files ?? []).filter((file) =>
    file.type.startsWith("image/"),
  )
}

export function NotionEditor({
  markdown,
  reloadKey,
  onChange,
  onReady,
  onError,
  onInfo,
  onExitTop,
  readOnly,
}: Props) {
  const parsedRef = useRef<ParsedMarkdown | null>(null)
  parsedRef.current ??= markdownToDocument(markdown)
  /** 最後に親とやり取りした値。同じなら onChange を呼ばない */
  const valueRef = useRef(markdown)
  const serializeRef = useRef(createSerializer())
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const callbacksRef = useRef({ onError, onInfo, onExitTop })
  callbacksRef.current = { onError, onInfo, onExitTop }
  const editorRef = useRef<Editor | null>(null)

  const [slash, setSlash] = useState<SlashState | null>(null)
  const [slashIndex, setSlashIndex] = useState(0)
  const slashRef = useRef({ slash, slashIndex })
  slashRef.current = { slash, slashIndex }
  const [math, setMath] = useState<MathRequest | null>(null)
  const [imagePicker, setImagePicker] = useState<number | null | false>(false)
  const [linkCard, setLinkCard] = useState(false)
  // リンクカードの OGP (src/plugins/link-cards の API)。この画面の間だけ覚えておく
  const [ogpStore] = useState(() =>
    createOgpStore({ get: api.linkCardOgp, refresh: api.linkCardRefresh }),
  )

  const insertUploads = useCallback(
    async (files: File[], pos: number | null) => {
      const editor = editorRef.current
      if (!editor) return
      for (const file of files) {
        callbacksRef.current.onInfo?.(`${file.name} をアップロード中…`)
        try {
          const { url } = await uploadMedia(file)
          const image = {
            type: "image",
            attrs: { src: url, alt: altFromFilename(file.name) },
          }
          if (pos === null) editor.chain().focus().insertContent(image).run()
          else editor.chain().focus().insertContentAt(pos, image).run()
          callbacksRef.current.onInfo?.(`${file.name} を挿入しました`)
        } catch (error) {
          callbacksRef.current.onError?.((error as Error).message)
        }
      }
    },
    [],
  )

  const context = useMemo<CommandContext>(
    () => ({
      openImage: () => setImagePicker(null),
      openMath: () => setMath({ pos: null, latex: "", display: true }),
      openLinkCard: () => setLinkCard(true),
    }),
    [],
  )
  const contextRef = useRef(context)
  contextRef.current = context

  const selectSlash = useCallback((command: SlashCommand, range: Range) => {
    const editor = editorRef.current
    if (!editor) return
    runSlashCommand(editor, command.id, range, contextRef.current)
  }, [])

  const extensions = useMemo(
    () => [
      ...createEditorExtensions({
        editMath: (request: MathEditRequest) => setMath(request),
      }),
      Placeholder.configure({
        placeholder: ({ node }) =>
          node.type.name === "heading"
            ? `見出し ${node.attrs.level}`
            : "「/」でコマンド、または入力を始める",
        showOnlyCurrent: true,
        includeChildren: false,
      }),
      LinkCards.configure({ store: ogpStore }),
      createSlashExtension({
        onOpen: (state) => {
          setSlash((previous) => {
            if (!previous || previous.query !== state.query) setSlashIndex(0)
            return state
          })
        },
        onClose: () => setSlash(null),
        onSelect: selectSlash,
        onKeyDown: (event) => {
          const { slash: current, slashIndex: index } = slashRef.current
          if (!current || current.items.length === 0) return false
          if (event.key === "ArrowDown") {
            setSlashIndex((index + 1) % current.items.length)
            return true
          }
          if (event.key === "ArrowUp") {
            setSlashIndex(
              (index - 1 + current.items.length) % current.items.length,
            )
            return true
          }
          if (event.key === "Enter" || event.key === "Tab") {
            const command = current.items[index]
            if (command) selectSlash(command, current.range)
            return true
          }
          return false
        },
      }),
      Extension.create({
        name: "notionEditorKeys",
        addKeyboardShortcuts: () => ({
          ArrowUp: ({ editor }) => {
            const { $from, empty } = editor.state.selection
            if (!empty || $from.index(0) !== 0 || $from.parentOffset !== 0) {
              return false
            }
            callbacksRef.current.onExitTop?.()
            return Boolean(callbacksRef.current.onExitTop)
          },
        }),
      }),
    ],
    [selectSlash, ogpStore],
  )

  const editor = useEditor({
    extensions,
    content: parsedRef.current.doc,
    editable: !readOnly,
    editorProps: {
      attributes: {
        class: "md-prose",
        role: "textbox",
        "aria-multiline": "true",
        "aria-label": "本文",
        spellcheck: "false",
        "data-testid": "body-editor",
      },
      handlePaste: (_view: EditorView, event: ClipboardEvent) => {
        const files = imageFiles(event.clipboardData?.files)
        if (files.length === 0) return false
        event.preventDefault()
        void insertUploads(files, null)
        return true
      },
      handleDrop: (
        view: EditorView,
        event: DragEvent,
        _slice: unknown,
        moved: boolean,
      ) => {
        const files = imageFiles(event.dataTransfer?.files)
        if (moved || files.length === 0) return false
        event.preventDefault()
        const pos =
          view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos ??
          null
        void insertUploads(files, pos)
        return true
      },
    },
    onUpdate: ({ editor: current }) => {
      const sourceMap = parsedRef.current?.sourceMap
      if (!sourceMap) return
      const next = serializeRef.current(current.state.doc, sourceMap)
      if (next === valueRef.current) return
      valueRef.current = next
      onChangeRef.current(next)
    },
  })
  editorRef.current = editor

  useEffect(() => {
    onReady?.(editor)
    return () => onReady?.(null)
  }, [editor, onReady])

  // 親が値を差し替えたとき (リビジョンの復元・ソース編集から戻る・衝突で再読込) だけ読み直す
  const loadedKey = useRef(reloadKey)
  useEffect(() => {
    if (!editor || loadedKey.current === reloadKey) return
    loadedKey.current = reloadKey
    const parsed = markdownToDocument(markdown)
    parsedRef.current = parsed
    serializeRef.current = createSerializer()
    valueRef.current = markdown
    editor.commands.setContent(parsed.doc, { emitUpdate: false })
  }, [editor, markdown, reloadKey])

  useEffect(() => {
    editor?.setEditable(!readOnly)
  }, [editor, readOnly])

  const applyMath = (latex: string, request: MathRequest) => {
    if (!editor) return
    const { pos, display } = request
    if (pos === null) {
      if (latex.trim()) {
        editor
          .chain()
          .focus()
          .insertContent(
            display
              ? [{ type: "mathBlock", attrs: { latex } }, { type: "paragraph" }]
              : { type: "mathInline", attrs: { latex } },
          )
          .run()
      }
    } else if (latex.trim()) {
      editor
        .chain()
        .focus()
        .command(({ tr }) => {
          tr.setNodeMarkup(pos, undefined, { latex })
          return true
        })
        .run()
    } else {
      editor
        .chain()
        .focus()
        .command(({ tr }) => {
          const node = tr.doc.nodeAt(pos)
          if (node) tr.delete(pos, pos + node.nodeSize)
          return true
        })
        .run()
    }
    setMath(null)
  }

  return (
    <div className="bwa-editor md-editor" data-markdown-editor="">
      <style>{editorCss}</style>
      {editor && !readOnly ? <BlockHandle editor={editor} /> : null}
      {editor && !readOnly ? (
        <BubbleToolbar
          editor={editor}
          onMath={() => {
            const { from, to } = editor.state.selection
            const latex = editor.state.doc.textBetween(from, to, " ")
            if (latex) editor.chain().focus().deleteSelection().run()
            setMath({ pos: null, latex, display: false })
          }}
        />
      ) : null}
      <EditorContent editor={editor} />
      {editor ? <LinkCardPopover editor={editor} store={ogpStore} /> : null}

      {slash ? (
        <SlashMenu
          state={slash}
          activeIndex={slashIndex}
          onHover={setSlashIndex}
          onSelect={(command) => selectSlash(command, slash.range)}
        />
      ) : null}

      {math ? (
        <MathDialog
          request={math}
          onApply={(latex) => applyMath(latex, math)}
          onClose={() => {
            setMath(null)
            editor?.commands.focus()
          }}
        />
      ) : null}

      {imagePicker !== false ? (
        <MediaPickerDialog
          title="画像を挿入"
          onClose={() => {
            setImagePicker(false)
            editor?.commands.focus()
          }}
          onPick={({ url, alt }) => {
            setImagePicker(false)
            editor
              ?.chain()
              .focus()
              .insertContent({ type: "image", attrs: { src: url, alt } })
              .run()
          }}
        />
      ) : null}

      {linkCard ? (
        <LinkCardDialog
          onClose={() => {
            setLinkCard(false)
            editor?.commands.focus()
          }}
          onApply={(url) => {
            setLinkCard(false)
            editor
              ?.chain()
              .focus()
              .insertContent([
                {
                  type: "paragraph",
                  content: [
                    {
                      type: "text",
                      text: url,
                      marks: [{ type: "link", attrs: { href: url } }],
                    },
                  ],
                },
                { type: "paragraph" },
              ])
              .run()
          }}
        />
      ) : null}
    </div>
  )
}

function SlashMenu({
  state,
  activeIndex,
  onHover,
  onSelect,
}: {
  state: SlashState
  activeIndex: number
  onHover: (index: number) => void
  onSelect: (command: SlashCommand) => void
}) {
  const listRef = useRef<HTMLDivElement>(null)
  const anchor = useMemo(
    () => ({ kind: "rect" as const, rect: () => state.clientRect?.() ?? null }),
    [state.clientRect],
  )
  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-index="${activeIndex}"]`)
      ?.scrollIntoView({ block: "nearest" })
  }, [activeIndex])

  let group = ""
  return (
    <Popover
      anchor={anchor}
      onClose={() => {}}
      keepFocus
      className="bwa-slash"
      label="ブロックを挿入"
    >
      <div
        ref={listRef}
        role="listbox"
        aria-label="ブロックの種類"
        data-testid="slash-menu"
      >
        {state.items.length === 0 ? (
          <p className="px-2 py-3 text-muted">該当するブロックはありません</p>
        ) : null}
        {state.items.map((command, index) => {
          const header = command.group !== group && !state.query
          group = command.group
          return (
            <div key={command.id}>
              {header ? (
                <div className="bwa-menu-label">{command.group}</div>
              ) : null}
              <button
                type="button"
                role="option"
                aria-selected={index === activeIndex}
                data-index={index}
                data-active={index === activeIndex}
                className="bwa-menu-item"
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => onHover(index)}
                onClick={() => onSelect(command)}
              >
                <span className="bwa-slash__icon">
                  {COMMAND_ICONS[command.id]}
                </span>
                <span className="bwa-slash__text">
                  <span>{command.label}</span>
                  <span className="bwa-slash__desc">{command.description}</span>
                </span>
              </button>
            </div>
          )
        })}
      </div>
    </Popover>
  )
}

/** ブロック左の「＋」と「⋮⋮」(ドラッグで移動・クリックでメニュー) */
function BlockHandle({ editor }: { editor: Editor }) {
  const [block, setBlock] = useState<{ pos: number; top: number } | null>(null)
  const [menu, setMenu] = useState<number | null>(null)
  const [convertOpen, setConvertOpen] = useState(false)
  const handleRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<HTMLButtonElement>(null)
  const menuAnchor = useMemo(
    () => ({ kind: "element" as const, ref: dragRef }),
    [],
  )

  useEffect(() => {
    const view = editor.view
    const root = view.dom.parentElement?.parentElement
    if (!root) return
    const onMove = (event: MouseEvent) => {
      if (menu !== null) return
      const target = event.target as Node
      if (handleRef.current?.contains(target)) return
      const rootRect = root.getBoundingClientRect()
      const editorRect = view.dom.getBoundingClientRect()
      // 本文の行と、その左の余白 (ハンドルの置き場) にいる間だけ出す
      if (
        event.clientY < editorRect.top ||
        event.clientY > editorRect.bottom ||
        event.clientX < rootRect.left - 96 ||
        event.clientX > editorRect.right + 24
      ) {
        setBlock(null)
        return
      }
      const found = view.posAtCoords({
        left: Math.min(
          Math.max(event.clientX, editorRect.left + 4),
          editorRect.right - 4,
        ),
        top: event.clientY,
      })
      if (!found) return
      const at = found.inside >= 0 ? found.inside : found.pos
      const $pos = view.state.doc.resolve(at)
      const pos = $pos.depth >= 1 ? $pos.before(1) : at
      const dom = view.nodeDOM(pos)
      if (!(dom instanceof HTMLElement)) return
      const rect = dom.getBoundingClientRect()
      const lineHeight =
        Number.parseFloat(getComputedStyle(dom).lineHeight) || 24
      const top =
        rect.top - rootRect.top + Math.min(rect.height, lineHeight) / 2 - 12
      setBlock((current) =>
        current?.pos === pos && current.top === top ? current : { pos, top },
      )
    }
    document.addEventListener("mousemove", onMove)
    return () => {
      document.removeEventListener("mousemove", onMove)
    }
  }, [editor, menu])

  // 文書が変わったら位置がずれるので隠す
  useEffect(() => {
    const hide = () => {
      if (menu === null) setBlock(null)
    }
    editor.on("update", hide)
    return () => {
      editor.off("update", hide)
    }
  }, [editor, menu])

  if (!block) return null

  const onDragStart = (event: ReactDragEvent) => {
    const { view } = editor
    const node = view.state.doc.nodeAt(block.pos)
    if (!node) return
    // ProseMirror の移動ドラッグにする (落とした先に移り、元の場所から消える)
    view.dispatch(
      view.state.tr.setSelection(
        NodeSelection.create(view.state.doc, block.pos),
      ),
    )
    const slice = view.state.selection.content()
    const dom = view.nodeDOM(block.pos)
    if (dom instanceof HTMLElement) event.dataTransfer.setDragImage(dom, 0, 0)
    event.dataTransfer.effectAllowed = "move"
    event.dataTransfer.setData("text/plain", node.textContent)
    ;(
      view as unknown as {
        dragging: { slice: typeof slice; move: boolean } | null
      }
    ).dragging = {
      slice,
      move: true,
    }
  }

  const close = () => {
    setMenu(null)
    setConvertOpen(false)
    setBlock(null)
  }

  return (
    <>
      <div
        ref={handleRef}
        className="bwa-handle"
        data-visible="true"
        style={{ top: block.top }}
        data-testid="block-handle"
      >
        <button
          type="button"
          aria-label="下にブロックを追加"
          title="クリックで下にブロックを追加"
          onClick={() => {
            insertBlockBelow(editor, block.pos)
            setBlock(null)
          }}
        >
          <PiPlusBold />
        </button>
        <button
          ref={dragRef}
          type="button"
          draggable
          data-drag=""
          aria-label="ブロックのメニュー (ドラッグで移動)"
          title="ドラッグで移動 / クリックでメニュー"
          onDragStart={onDragStart}
          onDragEnd={() => setBlock(null)}
          onClick={() => {
            editor
              .chain()
              .focus()
              .command(({ tr }) => {
                tr.setSelection(NodeSelection.create(tr.doc, block.pos))
                return true
              })
              .run()
            setMenu(block.pos)
          }}
        >
          <PiDotsSixVerticalBold />
        </button>
      </div>
      {menu !== null ? (
        <Popover anchor={menuAnchor} onClose={close} label="ブロックのメニュー">
          {convertOpen ? (
            <div role="menu" aria-label="変換">
              <div className="bwa-menu-label">変換</div>
              {SLASH_COMMANDS.filter((command) => command.convertible).map(
                (command) => (
                  <button
                    key={command.id}
                    role="menuitem"
                    className="bwa-menu-item"
                    onClick={() => {
                      convertBlock(editor, menu, command.id)
                      close()
                    }}
                  >
                    {COMMAND_ICONS[command.id]}
                    {command.label}
                  </button>
                ),
              )}
            </div>
          ) : (
            <div role="menu" aria-label="ブロックのメニュー">
              <button
                role="menuitem"
                className="bwa-menu-item"
                onClick={() => setConvertOpen(true)}
              >
                <PiTextTBold />
                変換
                <span className="bwa-menu-item__hint">›</span>
              </button>
              <button
                role="menuitem"
                className="bwa-menu-item"
                onClick={() => {
                  duplicateBlock(editor, menu)
                  close()
                }}
              >
                <PiCopyBold />
                複製
              </button>
              <button
                role="menuitem"
                className="bwa-menu-item"
                onClick={() => {
                  moveBlock(editor, menu, -1)
                  close()
                }}
              >
                <PiArrowUpBold />
                上へ移動
              </button>
              <button
                role="menuitem"
                className="bwa-menu-item"
                onClick={() => {
                  moveBlock(editor, menu, 1)
                  close()
                }}
              >
                <PiArrowDownBold />
                下へ移動
              </button>
              <button
                role="menuitem"
                className="bwa-menu-item"
                onClick={() => {
                  insertBlockBelow(editor, menu)
                  close()
                }}
              >
                <PiPlusBold />
                下にブロックを追加
              </button>
              <div className="bwa-menu-sep" />
              <button
                role="menuitem"
                className="bwa-menu-item bwa-menu-item--danger"
                onClick={() => {
                  deleteBlock(editor, menu)
                  close()
                }}
              >
                <PiTrashBold />
                削除
              </button>
            </div>
          )}
        </Popover>
      ) : null}
    </>
  )
}

/** テキストを選択すると浮かぶツールバー */
function BubbleToolbar({
  editor,
  onMath,
}: {
  editor: Editor
  onMath: () => void
}) {
  const [linkOpen, setLinkOpen] = useState(false)
  const [href, setHref] = useState("")
  const linkButton = useRef<HTMLButtonElement>(null)
  const linkAnchor = useMemo(
    () => ({ kind: "element" as const, ref: linkButton }),
    [],
  )
  const state = useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      bold: current.isActive("bold"),
      italic: current.isActive("italic"),
      strike: current.isActive("strike"),
      code: current.isActive("code"),
      link: current.isActive("link"),
    }),
  })

  const applyLink = () => {
    const value = href.trim()
    if (!value) editor.chain().focus().extendMarkRange("link").unsetLink().run()
    else
      editor
        .chain()
        .focus()
        .extendMarkRange("link")
        .setLink({ href: value })
        .run()
    setLinkOpen(false)
  }

  const button = (
    label: string,
    active: boolean | undefined,
    onClick: () => void,
    icon: ReactNode,
    ref?: Ref<HTMLButtonElement>,
  ) => (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      {icon}
    </button>
  )

  return (
    <BubbleMenu
      editor={editor}
      options={{ placement: "top", offset: 8 }}
      shouldShow={({ editor: current, state: editorState }) => {
        const { selection } = editorState
        if (selection.empty || selection instanceof NodeSelection) return false
        if (current.isActive("codeBlock")) return false
        return current.isEditable
      }}
    >
      <div
        className="bwa-bubble"
        role="toolbar"
        aria-label="書式"
        data-testid="bubble-toolbar"
      >
        {button(
          "太字 (⌘B)",
          state?.bold,
          () => editor.chain().focus().toggleBold().run(),
          <PiTextBBold />,
        )}
        {button(
          "斜体 (⌘I)",
          state?.italic,
          () => editor.chain().focus().toggleItalic().run(),
          <PiTextItalicBold />,
        )}
        {button(
          "打ち消し線",
          state?.strike,
          () => editor.chain().focus().toggleStrike().run(),
          <PiTextStrikethroughBold />,
        )}
        {button(
          "インラインコード (⌘E)",
          state?.code,
          () => editor.chain().focus().toggleCode().run(),
          <PiCodeBold />,
        )}
        <span className="bwa-bubble__sep" />
        {button(
          "リンク",
          state?.link,
          () => {
            const current = editor.getAttributes("link").href
            setHref(typeof current === "string" ? current : "")
            setLinkOpen(true)
          },
          <PiLinkBold />,
          linkButton,
        )}
        {button("数式にする", false, onMath, <PiFunctionBold />)}
      </div>
      {linkOpen ? (
        <Popover
          anchor={linkAnchor}
          onClose={() => setLinkOpen(false)}
          label="リンク"
        >
          <form
            className="flex gap-1 p-1"
            onSubmit={(event) => {
              event.preventDefault()
              applyLink()
            }}
          >
            <input
              className="bwa-input"
              type="url"
              placeholder="https://"
              aria-label="リンク先の URL"
              value={href}
              onChange={(event) => setHref(event.target.value)}
            />
            <button className="bwa-btn bwa-btn--primary" type="submit">
              {href.trim() ? "設定" : "解除"}
            </button>
          </form>
        </Popover>
      ) : null}
    </BubbleMenu>
  )
}

function MathDialog({
  request,
  onApply,
  onClose,
}: {
  request: MathRequest
  onApply: (latex: string) => void
  onClose: () => void
}) {
  const [latex, setLatex] = useState(request.latex)
  const preview = useMemo(
    () => renderLatex(latex, request.display),
    [latex, request.display],
  )
  return (
    <Dialog
      title={request.display ? "数式 (ブロック)" : "数式 (インライン)"}
      onClose={onClose}
      footer={
        <>
          <button className="bwa-btn bwa-btn--outline" onClick={onClose}>
            キャンセル
          </button>
          <button
            className="bwa-btn bwa-btn--primary"
            onClick={() => onApply(latex)}
          >
            {request.pos !== null && !latex.trim() ? "削除" : "決定"}
          </button>
        </>
      }
    >
      <textarea
        className="bwa-textarea font-mono"
        rows={4}
        aria-label="LaTeX"
        placeholder="\int_0^1 x\,dx"
        value={latex}
        onChange={(event) => setLatex(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault()
            onApply(latex)
          }
        }}
      />
      <div
        className="mt-3 min-h-10 overflow-x-auto rounded-md bg-subtle p-3"
        aria-live="polite"
      >
        {preview.error ? (
          <span className="text-[13px] text-danger">{preview.error}</span>
        ) : (
          <span dangerouslySetInnerHTML={{ __html: preview.html }} />
        )}
      </div>
      <p className="mt-2 text-[12.5px] text-muted">⌘Enter で決定</p>
    </Dialog>
  )
}

function LinkCardDialog({
  onApply,
  onClose,
}: {
  onApply: (url: string) => void
  onClose: () => void
}) {
  const [url, setUrl] = useState("")
  const valid = /^https?:\/\/\S+$/.test(url.trim())
  return (
    <Dialog title="リンクカード" onClose={onClose}>
      <form
        className="grid gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          if (valid) onApply(url.trim())
        }}
      >
        <p className="text-muted">
          URL だけの段落は、公開ページでリンクカード (タイトル・画像付き)
          になります。
        </p>
        <input
          className="bwa-input"
          type="url"
          placeholder="https://example.com/"
          aria-label="URL"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
        />
        <div className="flex justify-end">
          <button
            className="bwa-btn bwa-btn--primary"
            type="submit"
            disabled={!valid}
          >
            挿入
          </button>
        </div>
      </form>
    </Dialog>
  )
}
