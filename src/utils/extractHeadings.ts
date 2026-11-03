import type { TocItem } from "../components/TableOfContents/TableOfContents"

export function extractHeadings(html: string): TocItem[] {
  const headingRegex = /<h([2-4])([^>]*)>([\s\S]*?)<\/h\1>/g
  const idRegex = /\bid="([^"]+)"/
  const headings: TocItem[] = []
  let match: RegExpExecArray | null

  while ((match = headingRegex.exec(html)) !== null) {
    const level = Number.parseInt(match[1], 10) as 2 | 3 | 4
    const idMatch = idRegex.exec(match[2])
    if (!idMatch) continue
    const id = idMatch[1]
    const text = match[3]
      .replace(
        /<a\b[^>]*class="[^"]*\bheading-link\b[^"]*"[^>]*>[\s\S]*?<\/a>/g,
        "",
      )
      .replace(/<[^>]*>/g, "")
      .replace(/\s+/g, " ")
      .trim()
    if (!text) continue

    headings.push({ id, text, level })
  }

  return headings
}
