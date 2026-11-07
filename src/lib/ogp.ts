import legacyImages from "../data/legacy-og-images.json"
import type { BlogLocale, BlogPostData } from "./blog-posts"

const legacySlugs = {
  ja: new Set(legacyImages.ja),
  en: new Set(legacyImages.en),
}

export function getOgImagePath(post: BlogPostData, locale: BlogLocale): string {
  if (post.thumbnail) return post.thumbnail
  if (legacySlugs[locale].has(post.slug)) {
    return `/og/${locale === "en" ? "en/" : ""}${post.slug}.png`
  }
  return "/anon-icon.png"
}
