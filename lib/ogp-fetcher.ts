import cachedOgp from "../src/data/ogp-cache.json"

export type OgpData = {
  url: string
  title: string
  description?: string
  image?: string
  siteName?: string
  favicon?: string
  domain: string
}

type CacheEntry = { data: OgpData | null }

const cache: Record<string, CacheEntry> = cachedOgp

// Rendering a page must not issue network requests for links in its body.
// Previously fetched cards retain their metadata; new links use the existing
// domain-only fallback in rehype-rich-embeds.
export async function fetchOgp(url: string): Promise<OgpData | null> {
  return cache[url]?.data ?? null
}
