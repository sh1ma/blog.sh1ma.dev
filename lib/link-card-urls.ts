import type { Root } from "hast"
import { remark } from "remark"
import remarkGfm from "remark-gfm"
import { remarkAlert } from "remark-github-blockquote-alert"
import remarkMath from "remark-math"
import remarkRehype from "remark-rehype"
import { collectStandaloneUrls } from "./standalone-url"

// 記事の Markdown から、公開ページでリンクカード / X の埋め込みになる URL を集める。
// 公開ページ (src/lib/render-markdown.ts) の rehypeRichEmbeds の手前までと同じプラグインで
// hast にして、同じ判定 (standalone-url.ts) を使う。

const processor = remark()
  .use(remarkGfm)
  .use(remarkAlert)
  .use(remarkMath)
  .use(remarkRehype)

export type LinkCardUrl = { url: string; kind: "tweet" | "ogp" }

export async function collectLinkCardUrls(
  markdown: string,
): Promise<LinkCardUrl[]> {
  const tree = (await processor.run(processor.parse(markdown))) as Root
  return collectStandaloneUrls(tree).map(({ url, kind }) => ({ url, kind }))
}
