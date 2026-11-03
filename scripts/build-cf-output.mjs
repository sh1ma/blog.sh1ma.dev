import { copyFile, mkdir, readdir, readFile } from "node:fs/promises"
import { dirname, join, relative, resolve } from "node:path"
import {
  cleanBuildOutputDir,
  getWorkerBundleDir,
  readBuildOutput,
  writeAssets,
  writeRootConfig,
  writeWorkerConfig,
} from "@cloudflare/build-output-utils"

const root = process.cwd()
const serverDir = resolve(root, "dist/server")
const assetsDir = resolve(root, "dist/client")
const source = JSON.parse(
  await readFile(join(serverDir, "wrangler.json"), "utf8"),
)

if (source.main !== "entry.mjs" || !source.name) {
  throw new Error(
    "Astro の Worker エントリーポイントまたは名前が想定と異なります",
  )
}

const env = {}
for (const item of source.d1_databases ?? []) {
  env[item.binding] = { type: "d1", name: item.database_name }
}
for (const item of source.r2_buckets ?? []) {
  env[item.binding] = { type: "r2", name: item.bucket_name }
}
for (const item of source.kv_namespaces ?? []) {
  env[item.binding] = { type: "kv", ...(item.id ? { id: item.id } : {}) }
}
if (source.images?.binding) env[source.images.binding] = { type: "images" }
if (source.assets?.binding) env[source.assets.binding] = { type: "assets" }
for (const [name, value] of Object.entries(source.vars ?? {})) {
  if (typeof value !== "string")
    throw new Error(`文字列以外の環境変数: ${name}`)
  env[name] = { type: "text", value }
}
if (process.env.SITE_URL) {
  const siteUrl = new URL(process.env.SITE_URL)
  if (siteUrl.protocol !== "https:")
    throw new Error("SITE_URL は HTTPS が必要です")
  env.EMDASH_SITE_URL = { type: "text", value: siteUrl.origin }
}

for (const binding of ["DB", "MEDIA", "SESSION", "IMAGES", "ASSETS"]) {
  if (!env[binding])
    throw new Error(`必要な Worker binding がありません: ${binding}`)
}

const worker = {
  name: source.name,
  compatibilityDate: source.compatibility_date,
  compatibilityFlags: source.compatibility_flags,
  workersDev: source.workers_dev,
  previewUrls: source.preview_urls,
  domains: (source.routes ?? [])
    .filter((route) => route.custom_domain)
    .map((route) => route.pattern),
  triggers: (source.triggers?.crons ?? []).map((schedule) => ({
    type: "scheduled",
    schedule,
  })),
  observability: source.observability && {
    enabled: source.observability.enabled,
    traces: source.observability.traces && {
      enabled: source.observability.traces.enabled,
    },
  },
  env,
}

await cleanBuildOutputDir(root)
const bundleDir = getWorkerBundleDir(root)

async function copyModules(directory) {
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, item.name)
    if (item.isDirectory()) {
      await copyModules(path)
    } else if (item.isFile() && item.name.endsWith(".mjs")) {
      const destination = join(bundleDir, relative(serverDir, path))
      await mkdir(dirname(destination), { recursive: true })
      await copyFile(path, destination)
    }
  }
}

await copyModules(serverDir)
await writeAssets({ root, sourceDirectory: assetsDir })
await writeRootConfig(root, undefined, {
  isPreview: false,
  mode: process.env.CLOUDFLARE_ENV ?? "production",
})
await writeWorkerConfig({
  root,
  config: worker,
  manifest: { type: "partial", mainModule: source.main, modules: {} },
})

const output = await readBuildOutput(root)
console.log(
  `cf Build Output: ${output.workers.default.config.name} (${Object.keys(output.workers.default.config.manifest.modules).length} modules)`,
)
