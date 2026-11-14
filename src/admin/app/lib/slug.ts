// 記事の slug (URL の /articles/:slug)。既存記事は「公開日_英数字」
// (同じ日に複数あるときは「公開日_連番_英数字」) の形なので、それに合わせて提案する。
// 公開済みの記事の slug は変えない (URL を変えないため。CLAUDE.md の最重要ルール)。

export const SLUG_PATTERN = /^[a-z0-9]+(?:[_-][a-z0-9]+)*$/

/** "2026-11-14" → "20261114" */
export function datePrefix(publishedDate: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(publishedDate.trim())
  return match ? `${match[1]}${match[2]}${match[3]}` : null
}

/** タイトルから英数字の部分だけを取り出して snake_case にする (日本語は捨てる) */
export function asciiWords(title: string): string {
  return title
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60)
    .replace(/_+$/g, "")
}

/**
 * 公開日と既存の slug から、slug の頭 ("20261114_" や "20261114_2_") を決める。
 * 同じ日の記事がすでにあれば連番を付ける。
 */
export function slugPrefix(
  publishedDate: string,
  existingSlugs: Iterable<string>,
): string | null {
  const prefix = datePrefix(publishedDate)
  if (!prefix) return null
  const sameDay = [...existingSlugs].filter((slug) =>
    slug.startsWith(`${prefix}_`),
  )
  if (sameDay.length === 0) return `${prefix}_`
  let max = 1
  for (const slug of sameDay) {
    const match = /^\d{8}_(\d+)_/.exec(slug)
    if (match) max = Math.max(max, Number(match[1]))
  }
  return `${prefix}_${max + 1}_`
}

/** 提案。英数字が取れないときは頭だけ返す (続きはユーザーが書く) */
export function suggestSlug(
  publishedDate: string,
  title: string,
  existingSlugs: Iterable<string>,
): string {
  const prefix = slugPrefix(publishedDate, existingSlugs) ?? ""
  return `${prefix}${asciiWords(title)}`
}

export type SlugCheck = { ok: true } | { ok: false; message: string }

export function validateSlug(
  slug: string,
  existingSlugs: Iterable<string>,
): SlugCheck {
  const value = slug.trim()
  if (!value) return { ok: false, message: "slug を入力してください" }
  if (!SLUG_PATTERN.test(value)) {
    return {
      ok: false,
      message:
        "slug は半角英小文字・数字と _ - だけで書いてください (日本語は使えません)",
    }
  }
  if (/^\d{8}(?:_\d+)?$/.test(value)) {
    return {
      ok: false,
      message:
        "日付の後ろに英数字の名前を付けてください (例: 20261114_my_post)",
    }
  }
  for (const existing of existingSlugs) {
    if (existing === value) {
      return { ok: false, message: "同じ slug の記事がすでにあります" }
    }
  }
  return { ok: true }
}
