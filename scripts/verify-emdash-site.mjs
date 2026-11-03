import { readFile } from "node:fs/promises"

const baseUrl = process.argv[2]
if (!baseUrl || !/^https?:\/\//.test(baseUrl)) {
  throw new Error("Usage: pnpm verify:site <site-url>")
}

const site = new URL(baseUrl)
const posts = JSON.parse(await readFile("seed/seed.json", "utf8")).content.posts

function decodeHtml(value) {
  return value
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    )
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
}

async function get(path) {
  const response = await fetch(new URL(path, site), { redirect: "manual" })
  if (response.status !== 200) {
    throw new Error(`${path}: HTTP ${response.status}`)
  }
  return response.text()
}

for (const post of posts) {
  const path = `${post.locale === "en" ? "/en" : ""}/articles/${encodeURIComponent(post.slug)}`
  const html = await get(path)
  const title = decodeHtml(html.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? "")
  if (title !== post.data.title) {
    throw new Error(`${path}: title mismatch (${JSON.stringify(title)})`)
  }
}

for (const locale of ["ja", "en"]) {
  const path = locale === "ja" ? "/feed" : "/en/feed"
  const xml = await get(path)
  const actual = (xml.match(/<item>/g) ?? []).length
  const expected = posts.filter((post) => post.locale === locale).length
  if (actual !== expected) {
    throw new Error(`${path}: ${actual} items, expected ${expected}`)
  }
}

const sitemap = await get("/sitemap.xml")
const urlCount = (sitemap.match(/<url>/g) ?? []).length
if (urlCount !== posts.length + 4) {
  throw new Error(
    `/sitemap.xml: ${urlCount} URLs, expected ${posts.length + 4}`,
  )
}

console.log(
  `Verified ${posts.length} article URLs, two feeds, and ${urlCount} sitemap URLs at ${site.origin}`,
)
