import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"

const posts = JSON.parse(await readFile("seed/seed.json", "utf8")).content.posts
const manifest = { ja: [], en: [] }
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

for (let offset = 0; offset < posts.length; offset += 6) {
  const batch = posts.slice(offset, offset + 6)
  await Promise.all(
    batch.map(async (post) => {
      const path = `og/${post.locale === "en" ? "en/" : ""}${post.slug}.png`
      const url = new URL(path, "https://blog.sh1ma.dev/")
      const response = await fetch(url)
      if (
        !response.ok ||
        response.headers.get("content-type") !== "image/png"
      ) {
        throw new Error(`OGP 画像を取得できません: ${url} (${response.status})`)
      }
      const bytes = Buffer.from(await response.arrayBuffer())
      if (
        !bytes.subarray(0, pngSignature.length).equals(pngSignature) ||
        bytes.readUInt32BE(16) !== 1200 ||
        bytes.readUInt32BE(20) !== 630
      ) {
        throw new Error(`OGP 画像の形式が異なります: ${url}`)
      }
      const target = join("public", path)
      await mkdir(dirname(target), { recursive: true })
      await writeFile(target, bytes)
      manifest[post.locale].push(post.slug)
    }),
  )
}

manifest.ja.sort()
manifest.en.sort()
await writeFile(
  "src/data/legacy-og-images.json",
  `${JSON.stringify(manifest, null, 2)}\n`,
)
console.log(
  `Imported ${manifest.ja.length} ja + ${manifest.en.length} en OGP images`,
)
