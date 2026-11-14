import type { Editor, Range } from "@tiptap/core"
import { NodeSelection, TextSelection } from "@tiptap/pm/state"
import type { AlertType } from "../../../plugins/markdown-editor/schema"
import type { SlashCommandId } from "../lib/slash-commands"

// スラッシュコマンドとブロックメニューの「変換」の実体。

export type CommandContext = {
  /** 画像を選ぶ (アップロード / ライブラリ) ダイアログを開く */
  openImage: () => void
  /** 数式の入力ダイアログを開く */
  openMath: () => void
  /** リンクカードの URL 入力ダイアログを開く */
  openLinkCard: () => void
}

const ALERTS: Partial<Record<SlashCommandId, AlertType>> = {
  alertNote: "note",
  alertTip: "tip",
  alertImportant: "important",
  alertWarning: "warning",
  alertCaution: "caution",
}

/** 今のブロックの種類を変える (段落・見出し・リスト・引用・アラート・コード) */
function applyBlockType(editor: Editor, id: SlashCommandId): boolean {
  const chain = () => editor.chain().focus()
  const alert = ALERTS[id]
  if (alert) {
    if (editor.isActive("alert")) {
      return chain().updateAttributes("alert", { type: alert }).run()
    }
    return chain().wrapIn("alert", { type: alert }).run()
  }
  switch (id) {
    case "paragraph":
      return chain().clearNodes().setParagraph().run()
    case "heading1":
    case "heading2":
    case "heading3": {
      const level = Number(id.slice(-1)) as 1 | 2 | 3
      return chain().clearNodes().setHeading({ level }).run()
    }
    case "bulletList":
      return editor.isActive("bulletList")
        ? true
        : chain().clearNodes().toggleBulletList().run()
    case "orderedList":
      return editor.isActive("orderedList")
        ? true
        : chain().clearNodes().toggleOrderedList().run()
    case "taskList":
      return editor.isActive("taskList")
        ? true
        : chain().clearNodes().toggleTaskList().run()
    case "blockquote":
      return editor.isActive("blockquote")
        ? true
        : chain().clearNodes().toggleBlockquote().run()
    case "codeBlock":
      return chain().clearNodes().setCodeBlock().run()
    default:
      return false
  }
}

/** スラッシュコマンドを実行する。range は「/」から入力中の文字まで (消してから実行) */
export function runSlashCommand(
  editor: Editor,
  id: SlashCommandId,
  range: Range | null,
  context: CommandContext,
) {
  if (range) editor.chain().focus().deleteRange(range).run()
  switch (id) {
    case "table":
      editor
        .chain()
        .focus()
        .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
        .run()
      return
    case "horizontalRule":
      editor.chain().focus().setHorizontalRule().run()
      return
    case "mathBlock":
      context.openMath()
      return
    case "image":
      context.openImage()
      return
    case "linkCard":
      context.openLinkCard()
      return
    default:
      applyBlockType(editor, id)
  }
}

/** pos から始まる最上位ブロックの中身を選択してから種類を変える (ブロックメニューの「変換」) */
export function convertBlock(editor: Editor, pos: number, id: SlashCommandId) {
  const node = editor.state.doc.nodeAt(pos)
  if (!node) return
  const from = pos + 1
  const to = pos + node.nodeSize - 1
  const tr = editor.state.tr
  if (node.isAtom || !node.isBlock || to <= from) {
    tr.setSelection(NodeSelection.create(tr.doc, pos))
  } else {
    tr.setSelection(
      TextSelection.between(tr.doc.resolve(from), tr.doc.resolve(to)),
    )
  }
  editor.view.dispatch(tr)
  applyBlockType(editor, id)
}

export function deleteBlock(editor: Editor, pos: number) {
  const node = editor.state.doc.nodeAt(pos)
  if (!node) return
  editor
    .chain()
    .focus()
    .command(({ tr }) => {
      tr.delete(pos, pos + node.nodeSize)
      return true
    })
    .run()
}

export function duplicateBlock(editor: Editor, pos: number) {
  const node = editor.state.doc.nodeAt(pos)
  if (!node) return
  editor
    .chain()
    .focus()
    .command(({ tr }) => {
      tr.insert(pos + node.nodeSize, node.copy(node.content))
      return true
    })
    .run()
}

/** ブロックの下に空の段落を入れて「/」を打ち、スラッシュメニューを開く (Notion の「＋」) */
export function insertBlockBelow(editor: Editor, pos: number) {
  const node = editor.state.doc.nodeAt(pos)
  if (!node) return
  const at = pos + node.nodeSize
  editor
    .chain()
    .focus()
    .insertContentAt(at, {
      type: "paragraph",
      content: [{ type: "text", text: "/" }],
    })
    .setTextSelection(at + 2)
    .run()
}

/** ブロックを上下に動かす (キーボードでの並べ替え) */
export function moveBlock(editor: Editor, pos: number, direction: -1 | 1) {
  const { doc } = editor.state
  const node = doc.nodeAt(pos)
  if (!node) return
  const $pos = doc.resolve(pos)
  const index = $pos.index(0)
  const targetIndex = index + direction
  if (targetIndex < 0 || targetIndex >= doc.childCount) return
  const neighbour = doc.child(targetIndex)
  editor
    .chain()
    .focus()
    .command(({ tr }) => {
      tr.delete(pos, pos + node.nodeSize)
      const insertAt =
        direction === 1 ? pos + neighbour.nodeSize : pos - neighbour.nodeSize
      tr.insert(insertAt, node)
      tr.setSelection(NodeSelection.create(tr.doc, insertAt))
      return true
    })
    .run()
}
