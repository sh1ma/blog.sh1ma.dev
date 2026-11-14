import type { JSONContent } from "@tiptap/core"
import type { Node as ProseMirrorNode } from "@tiptap/pm/model"
import {
  blockToMarkdown,
  documentToMarkdown,
  type ListMarkers,
  nodeKey,
  type SourceMap,
} from "./markdown"

// エディタの文書を Markdown に戻す。管理画面の本文ウィジェット (MarkdownEditor.tsx) と
// 自前の管理画面のエディタ (src/admin/app/editor) の両方で使う。
// 触っていないブロックは sourceMap の元の文字列のまま書き戻す (markdown.ts)。

/** ブロックごとの JSON / キー / Markdown を ProseMirror のノード単位で覚えておく */
export function createSerializer() {
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
