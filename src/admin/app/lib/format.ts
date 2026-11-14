// 日付・サイズの表示

const dateTime = new Intl.DateTimeFormat("ja-JP", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
})

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return ""
  const time = Date.parse(iso)
  return Number.isNaN(time) ? iso : dateTime.format(time)
}

/** 「たった今」「5 分前」「3 時間前」、それより前は日時 */
export function formatRelative(iso: string, now = Date.now()): string {
  const time = Date.parse(iso)
  if (Number.isNaN(time)) return iso
  const seconds = Math.round((now - time) / 1000)
  if (seconds < 45) return "たった今"
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} 分前`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} 時間前`
  const days = Math.round(hours / 24)
  if (days < 7) return `${days} 日前`
  return formatDateTime(iso)
}

export function formatBytes(size: number | null | undefined): string {
  if (size === null || size === undefined) return ""
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / 1024 / 1024).toFixed(1)} MB`
}

/** ローカル時刻の YYYY-MM-DD */
export function todayLocal(date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** <input type="datetime-local"> の値 (ローカル時刻) */
export function toDateTimeLocal(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0")
  return `${todayLocal(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export const LOCALE_LABELS: Record<string, string> = {
  ja: "日本語",
  en: "English",
}

/** 公開ページの記事 URL (src/pages/articles/[slug].astro と src/pages/en/articles/[slug].astro) */
export function articlePath(slug: string, locale: string | null): string {
  const path = `/articles/${encodeURIComponent(slug)}`
  return locale === "en" ? `/en${path}` : path
}
