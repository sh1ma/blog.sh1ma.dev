import { getEmDashCollection, getEmDashEntry } from "emdash"

export type BlogLocale = "ja" | "en"

export type BlogPostData = {
  id: string
  slug: string
  locale: BlogLocale
  title: string
  description?: string
  thumbnail?: string
  published_date: string
  priority?: number
  tags?: string[]
  markdown: string
}

export async function listBlogPosts(locale: BlogLocale) {
  const posts: BlogPostData[] = []
  let cursor: string | undefined
  do {
    const result = await getEmDashCollection("posts", {
      locale,
      orderBy: { published_date: "desc" },
      limit: 100,
      cursor,
    })
    if (result.error) throw result.error
    posts.push(...result.entries.map((entry) => entry.data as BlogPostData))
    cursor = result.nextCursor ?? undefined
  } while (cursor)
  return posts.sort(
    (a, b) =>
      b.published_date.localeCompare(a.published_date) ||
      (b.priority ?? 0) - (a.priority ?? 0),
  )
}

export async function getBlogPost(slug: string, locale: BlogLocale) {
  const { entry, error } = await getEmDashEntry("posts", slug, { locale })
  if (error) throw error
  if (!entry || entry.data.locale !== locale) return null
  return entry.data as BlogPostData
}

export function readingTime(markdown: string) {
  return Math.ceil(markdown.length / 500)
}
