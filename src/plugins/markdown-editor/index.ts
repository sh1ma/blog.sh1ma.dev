import { fileURLToPath } from "node:url"
import type { PluginDescriptor } from "emdash"
import { PLUGIN_ID, PLUGIN_VERSION, type PluginOptions } from "./constants"

const resolve = (path: string) => fileURLToPath(new URL(path, import.meta.url))

// emdash() の plugins に渡す descriptor。entrypoint / adminEntry は EmDash が生成する
// 仮想モジュールから import されるので、リポジトリ内のファイルを絶対パスで指す。
export function markdownEditorPlugin(): PluginDescriptor<PluginOptions> {
  const adminEntry = resolve("./admin.tsx")
  return {
    id: PLUGIN_ID,
    version: PLUGIN_VERSION,
    format: "native",
    entrypoint: resolve("./plugin.ts"),
    // createPlugin() 側の admin.entry と同じ値にする (EmDash のドキュメントの指定)
    options: { adminEntry },
    adminEntry,
  }
}
