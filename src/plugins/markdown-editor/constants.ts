export const PLUGIN_ID = "markdown-editor"
export const PLUGIN_VERSION = "0.1.0"
export const WIDGET_NAME = "wysiwyg"

/** フィールドの widget に指定する値 */
export const WIDGET_ID = `${PLUGIN_ID}:${WIDGET_NAME}`

export type PluginOptions = { adminEntry: string }
