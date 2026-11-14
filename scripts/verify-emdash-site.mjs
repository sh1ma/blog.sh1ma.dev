import { readFile } from "node:fs/promises"

const baseUrl = process.argv[2]
if (!baseUrl || !/^https?:\/\//.test(baseUrl)) {
  throw new Error("Usage: pnpm verify:site <site-url>")
}

const site = new URL(baseUrl)
const posts = JSON.parse(await readFile("seed/seed.json", "utf8")).content.posts
const loopbackHosts = new Set(["localhost", "127.0.0.1"])

function matchesSiteOrigin(url) {
  if (loopbackHosts.has(site.hostname)) {
    return loopbackHosts.has(url.hostname) && url.port === site.port
  }
  return url.origin === site.origin
}

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

function meta(html, attribute, name) {
  const value = html.match(
    new RegExp(`<meta\\s+${attribute}="${name}"\\s+content="([^"]*)"`, "i"),
  )?.[1]
  if (!value) throw new Error(`Missing ${name} metadata`)
  return decodeHtml(value)
}

const home = await get("/")
if (meta(home, "property", "og:type") !== "website") {
  throw new Error("Home OG type must be website")
}

for (const post of posts) {
  const path = `${post.locale === "en" ? "/en" : ""}/articles/${encodeURIComponent(post.slug)}`
  const html = await get(path)
  const title = decodeHtml(html.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? "")
  if (title !== post.data.title) {
    throw new Error(`${path}: title mismatch (${JSON.stringify(title)})`)
  }
  const expectedImagePath = `/og/${post.locale === "en" ? "en/" : ""}${post.slug}.png`
  const ogUrl = new URL(meta(html, "property", "og:url"))
  const ogImage = new URL(meta(html, "property", "og:image"))
  if (
    meta(html, "property", "og:type") !== "article" ||
    meta(html, "property", "og:title") !== post.data.title ||
    !meta(html, "property", "og:description") ||
    ogUrl.pathname !== path ||
    !matchesSiteOrigin(ogUrl) ||
    ogImage.pathname !== expectedImagePath ||
    !matchesSiteOrigin(ogImage) ||
    meta(html, "name", "twitter:card") !== "summary_large_image" ||
    meta(html, "name", "twitter:title") !== post.data.title ||
    meta(html, "name", "twitter:image") !== ogImage.href
  ) {
    throw new Error(`${path}: OGP metadata mismatch`)
  }
  const imageUrl = new URL(expectedImagePath, site)
  const image = await fetch(imageUrl, { method: "HEAD" })
  if (
    image.status !== 200 ||
    image.headers.get("content-type") !== "image/png"
  ) {
    throw new Error(`${imageUrl}: OGP PNG is unavailable`)
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
  `Verified ${posts.length} article URLs and OGP images, two feeds, and ${urlCount} sitemap URLs at ${site.origin}`,
)
