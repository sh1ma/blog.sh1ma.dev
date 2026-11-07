import { Feed } from "feed"
import { type BlogLocale, listBlogPosts } from "./blog-posts"

export async function buildFeed(
  locale: BlogLocale,
  site: string,
): Promise<Response> {
  const english = locale === "en"
  const path = english ? "/en/feed" : "/feed"
  const feed = new Feed({
    title: english ? "blog.sh1ma.dev (English)" : "blog.sh1ma.dev",
    description: english ? "sh1ma's blog (English)" : "sh1maのブログです",
    feedLinks: { rss: `${site}${path}` },
    link: site,
    id: `${site}${path}`,
    language: locale,
    copyright: `All rights reserved ${new Date().getFullYear()}, sh1ma`,
  })

  for (const post of await listBlogPosts(locale)) {
    feed.addItem({
      title: post.title,
      description: post.description ?? "",
      link: `${site}${english ? "/en" : ""}/articles/${encodeURIComponent(post.slug)}`,
      date: new Date(`${post.published_date}T00:00:00Z`),
    })
  }

  return new Response(feed.rss2(), {
    headers: { "Content-Type": "application/rss+xml; charset=utf-8" },
  })
}
