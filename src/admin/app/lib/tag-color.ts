// タグのチップの色。Notion の色名をタグ名のハッシュで選ぶ (保存しない)。

export const TAG_COLORS = [
  "gray",
  "brown",
  "orange",
  "yellow",
  "green",
  "blue",
  "purple",
  "pink",
  "red",
] as const

export type TagColor = (typeof TAG_COLORS)[number]

/** FNV-1a。同じ名前なら環境によらず同じ色になる */
export function tagColor(name: string): TagColor {
  let hash = 0x811c9dc5
  for (const char of name) {
    hash ^= char.codePointAt(0) ?? 0
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return TAG_COLORS[hash % TAG_COLORS.length]
}
