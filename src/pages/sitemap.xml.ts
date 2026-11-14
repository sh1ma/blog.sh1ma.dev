import type { APIRoute } from "astro"
import { listBlogPosts } from "../lib/blog-posts"

const escapeXml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[character] ?? character,
  )

export const GET: APIRoute = async ({ site: configuredSite, url }) => {
  const site = (configuredSite ?? url).origin
  const [japanese, english] = await Promise.all([
    listBlogPosts("ja"),
    listBlogPosts("en"),
  ])
  const japaneseSlugs = new Set(japanese.map((post) => post.slug))
  const englishSlugs = new Set(english.map((post) => post.slug))
  const paths = ["/", "/about", "/en", "/en/about"]
  const articles = [
    ...japanese.map((post) => ({ locale: "ja", post })),
    ...english.map((post) => ({ locale: "en", post })),
  ]
  const entries = [
    ...paths.map(
      (path) => `<url><loc>${escapeXml(`${site}${path}`)}</loc></url>`,
    ),
    ...articles.map(({ locale, post }) => {
      const pathname = `${locale === "en" ? "/en" : ""}/articles/${encodeURIComponent(post.slug)}`
      const translated =
        locale === "ja"
          ? englishSlugs.has(post.slug)
          : japaneseSlugs.has(post.slug)
      const alternates = translated
        ? `<xhtml:link rel="alternate" hreflang="ja" href="${site}/articles/${encodeURIComponent(post.slug)}" /><xhtml:link rel="alternate" hreflang="en" href="${site}/en/articles/${encodeURIComponent(post.slug)}" />`
        : ""
      return `<url><loc>${escapeXml(`${site}${pathname}`)}</loc><lastmod>${post.published_date}</lastmod>${alternates}</url>`
    }),
  ]
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${entries.join("\n")}\n</urlset>\n`
  return new Response(xml, {
    headers: { "Content-Type": "application/xml; charset=utf-8" },
  })
}
