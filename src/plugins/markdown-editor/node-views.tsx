import { type AnyExtension, InputRule } from "@tiptap/core"
import { TextSelection } from "@tiptap/pm/state"
import {
  NodeViewContent,
  type NodeViewProps,
  NodeViewWrapper,
  ReactNodeViewRenderer,
} from "@tiptap/react"
import katex from "katex"
import { useMemo } from "react"
import {
  ALERT_TYPES,
  Alert,
  createExtensions,
  MathBlock,
  MathInline,
  RawMarkdown,
} from "./schema"

// 管理画面でだけ使う見た目 (node view) と入力ショートカット。
// 文書の構造は schema.ts のまま変えない。

export const ALERT_LABELS: Record<(typeof ALERT_TYPES)[number], string> = {
  note: "NOTE (補足)",
  tip: "TIP (ヒント)",
  important: "IMPORTANT (重要)",
  warning: "WARNING (警告)",
  caution: "CAUTION (注意)",
}

/** KaTeX で数式を描く。管理画面で KaTeX の CSS / フォントを読まなくて済むよう MathML で出す */
export function renderLatex(latex: string, displayMode: boolean) {
  try {
    return {
      html: katex.renderToString(latex, {
        displayMode,
        output: "mathml",
        throwOnError: true,
        strict: false,
      }),
      error: null,
    }
  } catch (error) {
    return { html: "", error: String((error as Error).message ?? error) }
  }
}

export type MathEditRequest = {
  pos: number
  latex: string
  display: boolean
}

type EditorCallbacks = {
  editMath: (request: MathEditRequest) => void
}

function MathView({ node, getPos, extension }: NodeViewProps) {
  const display = node.type.name === "mathBlock"
  const latex = String(node.attrs.latex ?? "")
  const { html, error } = useMemo(
    () => renderLatex(latex, display),
    [latex, display],
  )
  const callbacks = extension.options as EditorCallbacks
  const open = () => {
    const pos = getPos()
    if (typeof pos === "number") callbacks.editMath({ pos, latex, display })
  }
  const label = display ? "数式ブロックを編集" : "数式を編集"
  const content = !latex ? (
    <span className="md-math-error">（空の数式。ダブルクリックで編集）</span>
  ) : error ? (
    <span className="md-math-error">{`$${latex}$`}</span>
  ) : (
    <span dangerouslySetInnerHTML={{ __html: html }} />
  )
  return (
    <NodeViewWrapper
      as={display ? "div" : "span"}
      className={display ? undefined : "md-math-inline"}
      data-math={display ? "block" : "inline"}
      data-latex={latex}
      title={label}
      onDoubleClick={open}
    >
      {display ? (
        <div className="md-math-block" onDoubleClick={open}>
          {content}
        </div>
      ) : (
        content
      )}
    </NodeViewWrapper>
  )
}

function CodeBlockView({ node, updateAttributes }: NodeViewProps) {
  return (
    <NodeViewWrapper className="md-codeblock" data-code-block="">
      <div className="md-codeblock__bar" contentEditable={false}>
        <input
          className="md-input md-codeblock__lang"
          aria-label="コードの言語"
          placeholder="言語 (ts, bash …)"
          value={node.attrs.language ?? ""}
          onChange={(event) =>
            updateAttributes({ language: event.target.value.trim() || null })
          }
        />
        <input
          className="md-input md-codeblock__meta"
          aria-label="コードブロックの追加情報"
          placeholder='追加情報 (title="file.ts" など)'
          value={node.attrs.meta ?? ""}
          onChange={(event) =>
            updateAttributes({ meta: event.target.value || null })
          }
        />
      </div>
      <pre>
        <NodeViewContent<"code"> as="code" />
      </pre>
    </NodeViewWrapper>
  )
}

function AlertView({ node, updateAttributes }: NodeViewProps) {
  return (
    <NodeViewWrapper className="md-alert" data-alert={node.attrs.type}>
      <div className="md-alert__bar" contentEditable={false}>
        <select
          className="md-select"
          aria-label="アラートの種類"
          value={node.attrs.type}
          onChange={(event) => updateAttributes({ type: event.target.value })}
        >
          {ALERT_TYPES.map((type) => (
            <option key={type} value={type}>
              {ALERT_LABELS[type]}
            </option>
          ))}
        </select>
      </div>
      <NodeViewContent className="md-alert__body" />
    </NodeViewWrapper>
  )
}

function RawMarkdownView({ node, updateAttributes }: NodeViewProps) {
  const source = String(node.attrs.source ?? "")
  return (
    <NodeViewWrapper data-raw-markdown="">
      <div className="md-raw" contentEditable={false}>
        <span className="md-raw__label">
          Markdown のまま保持しているブロック (この欄で直接編集できます)
        </span>
        <textarea
          className="md-textarea"
          aria-label="Markdown のまま保持しているブロック"
          rows={Math.min(20, source.split("\n").length + 1)}
          value={source}
          onChange={(event) => updateAttributes({ source: event.target.value })}
        />
      </div>
    </NodeViewWrapper>
  )
}

const INLINE_MATH_RE = /(?<![$\\\w])\$([^\s$](?:[^$]*[^\s$])?)\$$/
const BLOCK_MATH_RE = /^\$\$\s$/

export function createEditorExtensions(
  callbacks: EditorCallbacks,
): AnyExtension[] {
  const overrides: Record<string, AnyExtension> = {
    mathInline: MathInline.extend({
      addOptions: () => callbacks,
      addNodeView: () => ReactNodeViewRenderer(MathView, { as: "span" }),
      addInputRules() {
        // $...$ と打つと、両端の $ ごと数式に置き換える
        return [
          new InputRule({
            find: INLINE_MATH_RE,
            handler: ({ state, range, match }) => {
              state.tr.replaceWith(
                range.from,
                range.to,
                this.type.create({ latex: match[1] }),
              )
            },
          }),
        ]
      },
    }),
    mathBlock: MathBlock.extend({
      addOptions: () => callbacks,
      addNodeView: () => ReactNodeViewRenderer(MathView),
      addInputRules() {
        // 空の段落で $$ と空白を打つと数式ブロックにして、編集パネルを開く
        return [
          new InputRule({
            find: BLOCK_MATH_RE,
            handler: ({ state, range }) => {
              const $from = state.doc.resolve(range.from)
              if ($from.parent.textContent !== "$$") return null
              const start = $from.before()
              const math = this.type.create({ latex: "" })
              const paragraph = state.schema.nodes.paragraph.create()
              state.tr.replaceWith(start, $from.after(), [math, paragraph])
              state.tr.setSelection(
                TextSelection.create(state.tr.doc, start + math.nodeSize + 1),
              )
              callbacks.editMath({ pos: start, latex: "", display: true })
            },
          }),
        ]
      },
    }),
    alert: Alert.extend({
      addNodeView: () => ReactNodeViewRenderer(AlertView),
    }),
    rawMarkdown: RawMarkdown.extend({
      addNodeView: () => ReactNodeViewRenderer(RawMarkdownView),
    }),
  }
  return createExtensions().map((extension) => {
    if (extension.name === "codeBlock") {
      return extension.extend({
        addNodeView: () => ReactNodeViewRenderer(CodeBlockView),
      })
    }
    return overrides[extension.name] ?? extension
  })
}
