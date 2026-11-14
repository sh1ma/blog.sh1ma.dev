import { fileURLToPath } from "node:url"
import type { PluginDescriptor } from "emdash"
import { PLUGIN_ID, PLUGIN_VERSION, type PluginOptions } from "./constants"

// emdash() の plugins に渡す descriptor。entrypoint は EmDash が生成する仮想モジュールから
// import されるので、リポジトリ内のファイルを絶対パスで指す (markdown-editor と同じ)。
export function linkCardsPlugin(): PluginDescriptor<PluginOptions> {
  return {
    id: PLUGIN_ID,
    version: PLUGIN_VERSION,
    format: "native",
    entrypoint: fileURLToPath(new URL("./plugin.ts", import.meta.url)),
    options: {},
  }
}
