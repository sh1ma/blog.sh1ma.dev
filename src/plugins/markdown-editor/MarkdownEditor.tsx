import { Extension, type JSONContent } from "@tiptap/core"
import type { Node as ProseMirrorNode } from "@tiptap/pm/model"
import type { EditorView } from "@tiptap/pm/view"
import {
  type Editor,
  EditorContent,
  useEditor,
  useEditorState,
} from "@tiptap/react"
import {
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react"
import {
  PiArrowClockwiseBold,
  PiArrowCounterClockwiseBold,
  PiCheckSquareBold,
  PiCodeBlockBold,
  PiCodeBold,
  PiColumnsPlusRightBold,
  PiFunctionBold,
  PiImageBold,
  PiLinkBold,
  PiListBulletsBold,
  PiListNumbersBold,
  PiMinusBold,
  PiQuotesBold,
  PiRowsPlusBottomBold,
  PiSigmaBold,
  PiTableBold,
  PiTextBBold,
  PiTextItalicBold,
  PiTextStrikethroughBold,
  PiTrashBold,
  PiWarningCircleBold,
} from "react-icons/pi"
import editorCss from "./editor.css?inline"
import {
  blockToMarkdown,
  documentToMarkdown,
  type ListMarkers,
  markdownToDocument,
  nodeKey,
  type ParsedMarkdown,
  type SourceMap,
} from "./markdown"
import { altFromFilename, uploadImage } from "./media"
import {
  createEditorExtensions,
  type MathEditRequest,
  renderLatex,
} from "./node-views"

export type FieldProps = {
  value: unknown
  onChange: (value: unknown) => void
  label: string
  id: string
  required?: boolean
  minimal?: boolean
}

type Mode = "wysiwyg" | "source"

type Panel =
  | { kind: "link"; href: string }
  | { kind: "image"; src: string; alt: string }
  | { kind: "math"; latex: string; display: boolean; pos: number | null }

type Status = { kind: "info" | "error"; text: string } | null

/** ブロックごとの JSON / キー / Markdown を ProseMirror のノード単位で覚えておく */
function createSerializer() {
  const json = new WeakMap<ProseMirrorNode, JSONContent>()
  const keys = new WeakMap<JSONContent, string>()
  const texts = new WeakMap<JSONContent, Map<string, string>>()

  return (doc: ProseMirrorNode, sourceMap: SourceMap): string => {
    const content: JSONContent[] = []
    doc.forEach((node) => {
      let value = json.get(node)
      if (!value) {
        value = node.toJSON() as JSONContent
        json.set(node, value)
      }
      content.push(value)
    })
    return documentToMarkdown(
      { type: "doc", content },
      {
        sourceMap,
        keyOf: (node) => {
          let key = keys.get(node)
          if (key === undefined) {
            key = nodeKey(node)
            keys.set(node, key)
          }
          return key
        },
        serializeBlock: (node, markers: ListMarkers) => {
          const cacheKey = markers.bullet + markers.bulletOrdered
          let byMarkers = texts.get(node)
          if (!byMarkers) {
            byMarkers = new Map()
            texts.set(node, byMarkers)
          }
          let text = byMarkers.get(cacheKey)
          if (text === undefined) {
            text = blockToMarkdown(node, markers)
            byMarkers.set(cacheKey, text)
          }
          return text
        },
      },
    )
  }
}

function imageFiles(files: FileList | null | undefined): File[] {
  return Array.from(files ?? []).filter((file) =>
    file.type.startsWith("image/"),
  )
}

function ToolbarButton({
  label,
  onClick,
  active,
  disabled,
  children,
}: {
  label: string
  onClick: () => void
  active?: boolean
  disabled?: boolean
  children: ReactNode
}) {
  return (
    <button
      type="button"
      className="md-button"
      title={label}
      aria-label={label}
      aria-pressed={active === undefined ? undefined : active}
      disabled={disabled}
      // ボタンを押してもエディタの選択範囲を失わないように
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

function useToolbarState(editor: Editor | null) {
  return useEditorState({
    editor,
    selector: ({ editor: current }) => {
      if (!current) return null
      const heading = [1, 2, 3, 4, 5, 6].find((level) =>
        current.isActive("heading", { level }),
      )
      return {
        heading: heading ? String(heading) : "p",
        bold: current.isActive("bold"),
        italic: current.isActive("italic"),
        strike: current.isActive("strike"),
        code: current.isActive("code"),
        link: current.isActive("link"),
        bulletList: current.isActive("bulletList"),
        orderedList: current.isActive("orderedList"),
        taskList: current.isActive("taskList"),
        blockquote: current.isActive("blockquote"),
        alert: current.isActive("alert"),
        codeBlock: current.isActive("codeBlock"),
        table: current.isActive("table"),
        canUndo: current.can().undo(),
        canRedo: current.can().redo(),
      }
    },
  })
}

export function MarkdownEditorField({
  value,
  onChange,
  label,
  id,
  required,
  minimal,
}: FieldProps) {
  const text = typeof value === "string" ? value : ""
  const labelId = useId()

  // valueRef: 管理画面と最後にやり取りした値。loadedRef: エディタに読み込んだ値
  const valueRef = useRef(text)
  const loadedRef = useRef(text)
  const parsedRef = useRef<ParsedMarkdown | null>(null)
  parsedRef.current ??= markdownToDocument(text)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const serializeRef = useRef(createSerializer())
  const editorRef = useRef<Editor | null>(null)

  const [mode, setMode] = useState<Mode>("wysiwyg")
  const [panel, setPanel] = useState<Panel | null>(null)
  const [status, setStatus] = useState<Status>(null)
  const [sourceText, setSourceText] = useState(text)
  const fileInputRef = useRef<HTMLInputElement>(null)

  /** 値が変わったときだけ管理画面に伝える (開いただけ・同じ内容では呼ばない) */
  const emit = useCallback((markdown: string) => {
    if (markdown === valueRef.current) return
    valueRef.current = markdown
    onChangeRef.current(markdown)
  }, [])

  const insertUploads = useCallback(
    async (files: File[], pos: number | null) => {
      const editor = editorRef.current
      if (!editor) return
      for (const file of files) {
        setStatus({ kind: "info", text: `${file.name} をアップロード中…` })
        try {
          const src = await uploadImage(file)
          const image = {
            type: "image",
            attrs: { src, alt: altFromFilename(file.name) },
          }
          if (pos === null) {
            editor.chain().focus().insertContent(image).run()
          } else {
            editor.chain().focus().insertContentAt(pos, image).run()
          }
          setStatus({ kind: "info", text: `${file.name} を挿入しました` })
        } catch (error) {
          setStatus({ kind: "error", text: (error as Error).message })
        }
      }
    },
    [],
  )

  const openLinkPanel = useCallback(() => {
    const href = editorRef.current?.getAttributes("link").href
    setPanel({ kind: "link", href: typeof href === "string" ? href : "" })
  }, [])

  const extensions = useMemo(
    () => [
      ...createEditorExtensions({
        editMath: (request: MathEditRequest) =>
          setPanel({ kind: "math", ...request }),
      }),
      Extension.create({
        name: "markdownEditorShortcuts",
        addKeyboardShortcuts: () => ({
          "Mod-k": () => {
            openLinkPanel()
            return true
          },
        }),
      }),
    ],
    [openLinkPanel],
  )

  const editor = useEditor({
    extensions,
    content: parsedRef.current.doc,
    editorProps: {
      attributes: {
        id,
        class: "md-prose",
        role: "textbox",
        "aria-multiline": "true",
        "aria-labelledby": labelId,
        ...(required ? { "aria-required": "true" } : {}),
        spellcheck: "false",
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
      emit(serializeRef.current(current.state.doc, sourceMap))
    },
  })
  editorRef.current = editor

  const load = useCallback(
    (markdown: string) => {
      const parsed = markdownToDocument(markdown)
      parsedRef.current = parsed
      loadedRef.current = markdown
      editor?.commands.setContent(parsed.doc, { emitUpdate: false })
    },
    [editor],
  )

  // 管理画面側で値が変わったとき (リビジョンの復元など) はエディタに読み込み直す
  useEffect(() => {
    if (text === valueRef.current) return
    valueRef.current = text
    if (mode === "wysiwyg") load(text)
    else setSourceText(text)
  }, [text, mode, load])

  const switchMode = (next: Mode) => {
    if (next === mode) return
    setPanel(null)
    if (next === "wysiwyg" && valueRef.current !== loadedRef.current) {
      load(valueRef.current)
    }
    if (next === "source") setSourceText(valueRef.current)
    setMode(next)
  }

  const state = useToolbarState(editor)
  const chain = () => editor?.chain().focus()

  const applyLink = (href: string) => {
    if (!editor) return
    const trimmed = href.trim()
    if (!trimmed) {
      editor.chain().focus().extendMarkRange("link").unsetLink().run()
    } else if (editor.state.selection.empty && !editor.isActive("link")) {
      editor
        .chain()
        .focus()
        .insertContent({
          type: "text",
          text: trimmed,
          marks: [{ type: "link", attrs: { href: trimmed } }],
        })
        .run()
    } else {
      editor
        .chain()
        .focus()
        .extendMarkRange("link")
        .setLink({ href: trimmed })
        .run()
    }
    setPanel(null)
  }

  const applyMath = (latex: string, display: boolean, pos: number | null) => {
    if (!editor) return
    if (pos === null) {
      if (latex.trim()) {
        // ブロックの数式は後ろに段落を置いてカーソルを移す (数式が選択されたままだと
        // 次の入力や挿入で置き換わってしまうため)
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
    setPanel(null)
  }

  const openMath = (display: boolean) => {
    if (!editor) return
    const { from, to } = editor.state.selection
    const latex = editor.state.doc.textBetween(from, to, " ")
    if (latex) editor.chain().focus().deleteSelection().run()
    setPanel({ kind: "math", latex, display, pos: null })
  }

  const wysiwyg = mode === "wysiwyg"
  const disabled = !wysiwyg || !editor

  return (
    <div
      className="md-editor"
      data-markdown-editor=""
      data-mode={mode}
      data-minimal={minimal ? "true" : "false"}
    >
      <style>{editorCss}</style>
      <div className="md-editor__header" hidden={minimal}>
        <span
          id={labelId}
          className="md-editor__label"
          onClick={() =>
            wysiwyg
              ? editor?.commands.focus()
              : document.getElementById(`${id}-source`)?.focus()
          }
        >
          {label}
          {required ? (
            <span className="md-editor__required" aria-hidden="true">
              *
            </span>
          ) : null}
        </span>
      </div>

      <div className="md-editor__frame">
        <div
          className="md-toolbar"
          role="toolbar"
          aria-label={`${label} の書式`}
        >
          <div className="md-toolbar__group">
            <select
              className="md-select"
              aria-label="段落の種類"
              disabled={disabled}
              value={state?.heading ?? "p"}
              onChange={(event) => {
                const level = Number(event.target.value)
                if (level) {
                  chain()
                    ?.setHeading({ level: level as 1 | 2 | 3 | 4 | 5 | 6 })
                    .run()
                } else {
                  chain()?.setParagraph().run()
                }
              }}
            >
              <option value="p">本文</option>
              <option value="1">見出し 1</option>
              <option value="2">見出し 2</option>
              <option value="3">見出し 3</option>
              <option value="4">見出し 4</option>
              <option value="5">見出し 5</option>
              <option value="6">見出し 6</option>
            </select>
          </div>
          <div className="md-toolbar__group">
            <ToolbarButton
              label="太字 (Ctrl+B)"
              active={state?.bold}
              disabled={disabled}
              onClick={() => chain()?.toggleBold().run()}
            >
              <PiTextBBold />
            </ToolbarButton>
            <ToolbarButton
              label="斜体 (Ctrl+I)"
              active={state?.italic}
              disabled={disabled}
              onClick={() => chain()?.toggleItalic().run()}
            >
              <PiTextItalicBold />
            </ToolbarButton>
            <ToolbarButton
              label="打ち消し線"
              active={state?.strike}
              disabled={disabled}
              onClick={() => chain()?.toggleStrike().run()}
            >
              <PiTextStrikethroughBold />
            </ToolbarButton>
            <ToolbarButton
              label="インラインコード (Ctrl+E)"
              active={state?.code}
              disabled={disabled}
              onClick={() => chain()?.toggleCode().run()}
            >
              <PiCodeBold />
            </ToolbarButton>
            <ToolbarButton
              label="リンク (Ctrl+K)"
              active={state?.link}
              disabled={disabled}
              onClick={openLinkPanel}
            >
              <PiLinkBold />
            </ToolbarButton>
          </div>
          <div className="md-toolbar__group">
            <ToolbarButton
              label="箇条書き"
              active={state?.bulletList}
              disabled={disabled}
              onClick={() => chain()?.toggleBulletList().run()}
            >
              <PiListBulletsBold />
            </ToolbarButton>
            <ToolbarButton
              label="番号付きリスト"
              active={state?.orderedList}
              disabled={disabled}
              onClick={() => chain()?.toggleOrderedList().run()}
            >
              <PiListNumbersBold />
            </ToolbarButton>
            <ToolbarButton
              label="タスクリスト"
              active={state?.taskList}
              disabled={disabled}
              onClick={() => chain()?.toggleTaskList().run()}
            >
              <PiCheckSquareBold />
            </ToolbarButton>
            <ToolbarButton
              label="引用"
              active={state?.blockquote}
              disabled={disabled}
              onClick={() => chain()?.toggleBlockquote().run()}
            >
              <PiQuotesBold />
            </ToolbarButton>
            <ToolbarButton
              label="アラート (> [!NOTE])"
              active={state?.alert}
              disabled={disabled}
              onClick={() =>
                state?.alert
                  ? chain()?.lift("alert").run()
                  : chain()?.wrapIn("alert", { type: "note" }).run()
              }
            >
              <PiWarningCircleBold />
            </ToolbarButton>
          </div>
          <div className="md-toolbar__group">
            <ToolbarButton
              label="コードブロック"
              active={state?.codeBlock}
              disabled={disabled}
              onClick={() => chain()?.toggleCodeBlock().run()}
            >
              <PiCodeBlockBold />
            </ToolbarButton>
            <ToolbarButton
              label="表を挿入"
              disabled={disabled || state?.table}
              onClick={() =>
                chain()
                  ?.insertTable({ rows: 3, cols: 3, withHeaderRow: true })
                  .run()
              }
            >
              <PiTableBold />
            </ToolbarButton>
            <ToolbarButton
              label="画像"
              disabled={disabled}
              onClick={() => setPanel({ kind: "image", src: "", alt: "" })}
            >
              <PiImageBold />
            </ToolbarButton>
            <ToolbarButton
              label="数式 ($...$)"
              disabled={disabled}
              onClick={() => openMath(false)}
            >
              <PiFunctionBold />
            </ToolbarButton>
            <ToolbarButton
              label="数式ブロック ($$...$$)"
              disabled={disabled}
              onClick={() => openMath(true)}
            >
              <PiSigmaBold />
            </ToolbarButton>
            <ToolbarButton
              label="水平線"
              disabled={disabled}
              onClick={() => chain()?.setHorizontalRule().run()}
            >
              <PiMinusBold />
            </ToolbarButton>
          </div>
          {state?.table && wysiwyg ? (
            <div className="md-toolbar__group">
              <ToolbarButton
                label="下に行を追加"
                onClick={() => chain()?.addRowAfter().run()}
              >
                <PiRowsPlusBottomBold />
              </ToolbarButton>
              <ToolbarButton
                label="右に列を追加"
                onClick={() => chain()?.addColumnAfter().run()}
              >
                <PiColumnsPlusRightBold />
              </ToolbarButton>
              <ToolbarButton
                label="行を削除"
                onClick={() => chain()?.deleteRow().run()}
              >
                行
                <PiTrashBold />
              </ToolbarButton>
              <ToolbarButton
                label="列を削除"
                onClick={() => chain()?.deleteColumn().run()}
              >
                列
                <PiTrashBold />
              </ToolbarButton>
              <ToolbarButton
                label="表を削除"
                onClick={() => chain()?.deleteTable().run()}
              >
                表
                <PiTrashBold />
              </ToolbarButton>
            </div>
          ) : null}
          <div className="md-toolbar__group">
            <ToolbarButton
              label="元に戻す (Ctrl+Z)"
              disabled={disabled || !state?.canUndo}
              onClick={() => chain()?.undo().run()}
            >
              <PiArrowCounterClockwiseBold />
            </ToolbarButton>
            <ToolbarButton
              label="やり直す (Ctrl+Shift+Z)"
              disabled={disabled || !state?.canRedo}
              onClick={() => chain()?.redo().run()}
            >
              <PiArrowClockwiseBold />
            </ToolbarButton>
          </div>
          <div className="md-toolbar__spacer" />
          <fieldset className="md-mode" aria-label="編集モード">
            <button
              type="button"
              className="md-button"
              aria-pressed={wysiwyg}
              onClick={() => switchMode("wysiwyg")}
            >
              WYSIWYG
            </button>
            <button
              type="button"
              className="md-button"
              aria-pressed={!wysiwyg}
              onClick={() => switchMode("source")}
            >
              Markdown
            </button>
          </fieldset>
        </div>

        {panel && wysiwyg ? (
          <PanelView
            key={JSON.stringify(panel)}
            panel={panel}
            onClose={() => {
              setPanel(null)
              editor?.commands.focus()
            }}
            onLink={applyLink}
            onMath={applyMath}
            onImageUrl={(src, alt) => {
              if (src.trim()) {
                chain()
                  ?.insertContent({
                    type: "image",
                    attrs: { src: src.trim(), alt },
                  })
                  .run()
              }
              setPanel(null)
            }}
            onPickFile={() => fileInputRef.current?.click()}
          />
        ) : null}

        {status ? (
          <div
            className="md-status"
            data-kind={status.kind}
            role={status.kind === "error" ? "alert" : "status"}
          >
            {status.text}
          </div>
        ) : null}

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          aria-label="アップロードする画像"
          onChange={(event) => {
            const files = imageFiles(event.target.files)
            event.target.value = ""
            setPanel(null)
            void insertUploads(files, null)
          }}
        />

        <div hidden={!wysiwyg}>
          <EditorContent editor={editor} />
        </div>
        {wysiwyg ? null : (
          <textarea
            id={`${id}-source`}
            className="md-source"
            aria-labelledby={labelId}
            aria-required={required || undefined}
            spellCheck={false}
            value={sourceText}
            onChange={(event) => {
              setSourceText(event.target.value)
              emit(event.target.value)
            }}
          />
        )}
      </div>
    </div>
  )
}

function PanelView({
  panel,
  onClose,
  onLink,
  onMath,
  onImageUrl,
  onPickFile,
}: {
  panel: Panel
  onClose: () => void
  onLink: (href: string) => void
  onMath: (latex: string, display: boolean, pos: number | null) => void
  onImageUrl: (src: string, alt: string) => void
  onPickFile: () => void
}) {
  const [first, setFirst] = useState(
    panel.kind === "link"
      ? panel.href
      : panel.kind === "image"
        ? panel.src
        : panel.latex,
  )
  const [alt, setAlt] = useState(panel.kind === "image" ? panel.alt : "")
  const mathId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  // パネルを開いたら入力欄に移る
  useEffect(() => {
    inputRef.current?.focus()
    textareaRef.current?.focus()
  }, [])
  const preview = useMemo(
    () =>
      panel.kind === "math" ? renderLatex(first, panel.display) : undefined,
    [panel, first],
  )

  const submit = () => {
    if (panel.kind === "link") onLink(first)
    else if (panel.kind === "image") onImageUrl(first, alt)
    else onMath(first, panel.display, panel.pos)
  }
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault()
      onClose()
    } else if (
      event.key === "Enter" &&
      !event.nativeEvent.isComposing &&
      (panel.kind !== "math" || event.metaKey || event.ctrlKey)
    ) {
      event.preventDefault()
      submit()
    }
  }

  if (panel.kind === "link") {
    return (
      <fieldset className="md-panel" aria-label="リンクの編集">
        <label>
          URL
          <input
            className="md-input"
            type="url"
            ref={inputRef}
            value={first}
            placeholder="https://"
            onChange={(event) => setFirst(event.target.value)}
            onKeyDown={onKeyDown}
          />
        </label>
        <button type="button" className="md-button" onClick={submit}>
          適用
        </button>
        <button type="button" className="md-button" onClick={() => onLink("")}>
          リンクを外す
        </button>
        <button type="button" className="md-button" onClick={onClose}>
          閉じる
        </button>
      </fieldset>
    )
  }

  if (panel.kind === "image") {
    return (
      <fieldset className="md-panel" aria-label="画像の挿入">
        <button type="button" className="md-button" onClick={onPickFile}>
          ファイルを選んでアップロード
        </button>
        <span>または</span>
        <label>
          URL
          <input
            className="md-input"
            type="url"
            value={first}
            placeholder="https://"
            onChange={(event) => setFirst(event.target.value)}
            onKeyDown={onKeyDown}
          />
        </label>
        <label>
          代替テキスト
          <input
            className="md-input"
            value={alt}
            onChange={(event) => setAlt(event.target.value)}
            onKeyDown={onKeyDown}
          />
        </label>
        <button type="button" className="md-button" onClick={submit}>
          URL の画像を挿入
        </button>
        <button type="button" className="md-button" onClick={onClose}>
          閉じる
        </button>
      </fieldset>
    )
  }

  return (
    <fieldset
      className="md-panel"
      aria-label={panel.display ? "数式ブロックの編集" : "数式の編集"}
    >
      <div className="md-panel__math">
        <label htmlFor={mathId}>
          {panel.display ? "数式ブロック ($$...$$)" : "数式 ($...$)"} — LaTeX。
          Ctrl+Enter で適用
        </label>
        <textarea
          id={mathId}
          className="md-textarea"
          rows={panel.display ? 4 : 2}
          ref={textareaRef}
          value={first}
          onChange={(event) => setFirst(event.target.value)}
          onKeyDown={onKeyDown}
        />
        <div className="md-panel__preview" aria-live="polite">
          {preview?.error ? (
            <span className="md-math-error">{preview.error}</span>
          ) : (
            <span dangerouslySetInnerHTML={{ __html: preview?.html ?? "" }} />
          )}
        </div>
        <div>
          <button type="button" className="md-button" onClick={submit}>
            適用
          </button>
          <button type="button" className="md-button" onClick={onClose}>
            閉じる
          </button>
        </div>
      </div>
    </fieldset>
  )
}
