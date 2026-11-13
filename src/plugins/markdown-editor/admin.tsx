import { lazy, Suspense } from "react"
import { WIDGET_NAME } from "./constants"
import type { FieldProps } from "./MarkdownEditor"

// EmDash の管理画面が読み込むモジュール (descriptor の adminEntry)。
// フィールドの widget: "markdown-editor:wysiwyg" で MarkdownEditorField が使われる。
// エディタ本体は管理画面の全ページで読み込まれないよう、別チャンクにして遅延読み込みする。
const MarkdownEditorField = lazy(async () => ({
  default: (await import("./MarkdownEditor")).MarkdownEditorField,
}))

// 管理画面は typeof === "function" でウィジェットを判定するので、関数コンポーネントで包む
function MarkdownField(props: FieldProps) {
  return (
    <Suspense
      fallback={
        <p role="status" style={{ fontSize: "0.875rem", opacity: 0.7 }}>
          {props.label}: エディタを読み込み中…
        </p>
      }
    >
      <MarkdownEditorField {...props} />
    </Suspense>
  )
}

export const fields = { [WIDGET_NAME]: MarkdownField }
