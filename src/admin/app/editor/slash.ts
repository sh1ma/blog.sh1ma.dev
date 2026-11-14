import { Extension, type Range } from "@tiptap/core"
import { PluginKey } from "@tiptap/pm/state"
import Suggestion, {
  exitSuggestion,
  type SuggestionProps,
} from "@tiptap/suggestion"
import { filterCommands, type SlashCommand } from "../lib/slash-commands"

// 「/」で開くメニュー。候補の計算と開閉は @tiptap/suggestion に任せ、
// 見た目は NotionEditor の SlashMenu (React) が持つ。

export type SlashState = {
  items: SlashCommand[]
  query: string
  range: Range
  clientRect: (() => DOMRect | null) | null
}

export type SlashCallbacks = {
  onOpen: (state: SlashState) => void
  onClose: () => void
  /** 上下・Enter・Esc。処理したら true */
  onKeyDown: (event: KeyboardEvent) => boolean
  /** 選んだコマンドを実行する */
  onSelect: (command: SlashCommand, range: Range) => void
}

export const slashPluginKey = new PluginKey("slashCommand")

export function createSlashExtension(callbacks: SlashCallbacks) {
  return Extension.create({
    name: "slashCommand",
    addProseMirrorPlugins() {
      return [
        Suggestion<SlashCommand, SlashCommand>({
          editor: this.editor,
          pluginKey: slashPluginKey,
          char: "/",
          // コードブロックの中では開かない
          allow: ({ state, range }) => {
            const $from = state.doc.resolve(range.from)
            return !$from.parent.type.spec.code
          },
          items: ({ query }) => filterCommands(query),
          command: ({ range, props }) => callbacks.onSelect(props, range),
          render: () => {
            const toState = (
              props: SuggestionProps<SlashCommand, SlashCommand>,
            ) => ({
              items: props.items,
              query: props.query,
              range: props.range,
              clientRect: props.clientRect ?? null,
            })
            return {
              onStart: (props) => callbacks.onOpen(toState(props)),
              onUpdate: (props) => callbacks.onOpen(toState(props)),
              onKeyDown: ({ event, view }) => {
                if (event.key === "Escape") {
                  // メニューを閉じて「/」はそのまま残す (Notion と同じ)
                  exitSuggestion(view, slashPluginKey)
                  return true
                }
                return callbacks.onKeyDown(event)
              },
              onExit: () => callbacks.onClose(),
            }
          },
        }),
      ]
    },
  })
}
