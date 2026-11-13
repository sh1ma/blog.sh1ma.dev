import { definePlugin } from "emdash"
import {
  PLUGIN_ID,
  PLUGIN_VERSION,
  type PluginOptions,
  WIDGET_NAME,
} from "./constants"

// Worker に入るのはこのファイルだけ。エディタ本体 (admin.tsx) は import しない。
export function createPlugin(options: PluginOptions) {
  return definePlugin({
    id: PLUGIN_ID,
    version: PLUGIN_VERSION,
    admin: {
      entry: options.adminEntry,
      fieldWidgets: [
        {
          name: WIDGET_NAME,
          label: "Markdown (WYSIWYG)",
          fieldTypes: ["text"],
        },
      ],
    },
  })
}
