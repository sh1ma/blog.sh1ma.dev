import { PluginStorageRepository } from "emdash"
import { getDb } from "emdash/runtime"
import { createOgpResolver, type OgpRecord } from "../../lib/ogp-fetcher"
import { OGP_COLLECTION, PLUGIN_ID } from "../plugins/link-cards/constants"

// 公開ページの描画からリンクカードの OGP を読む (書かない・外へ取りに行かない)。
// プラグインのストレージ (_plugin_storage) を EmDash の公開 API (emdash/runtime の getDb と
// emdash の PluginStorageRepository) で直接読み、無ければ src/data/ogp-cache.json を使う。
// DB を読めないとき (ビルド時など) は createOgpResolver が JSON だけで続ける。
export const storedOgpResolver = createOgpResolver(async (keys) => {
  const repo = new PluginStorageRepository<OgpRecord>(
    await getDb(),
    PLUGIN_ID,
    OGP_COLLECTION,
    [],
  )
  return repo.getMany(keys)
})
