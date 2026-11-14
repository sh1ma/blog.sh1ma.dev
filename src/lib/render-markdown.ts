import type { Element, Root } from "hast"
import rehypeKatex from "rehype-katex"
import rehypePrettyCode from "rehype-pretty-code"
import rehypeStringify from "rehype-stringify"
import { remark } from "remark"
import remarkGfm from "remark-gfm"
import { remarkAlert } from "remark-github-blockquote-alert"
import remarkMath from "remark-math"
import remarkRehype from "remark-rehype"
import {
  createHighlighter,
  createJavaScriptRegexEngine,
  type ThemeRegistrationRaw,
} from "shiki"
import { visit } from "unist-util-visit"
import type { OgpResolver } from "../../lib/ogp-fetcher"
import { rehypeHeadingAnchors } from "../../lib/rehype-heading-anchors"
import {
  type RichEmbedsFileData,
  rehypeRichEmbeds,
} from "../../lib/rehype-rich-embeds"
import atomOneDarkJson from "../../themes/atom-one-dark.json"

const atomOneDark = {
  ...atomOneDarkJson,
  type: "dark",
  settings: [],
} as ThemeRegistrationRaw

const enableLineNumbers = () => (tree: Root) => {
  visit(tree, "element", (node: Element) => {
    if (
      node.tagName === "code" &&
      typeof (
        node.properties?.["data-language"] ?? node.properties?.dataLanguage
      ) === "string"
    ) {
      node.properties ??= {}
      node.properties["data-line-numbers"] = ""
    }
  })
}

const processor = remark()
  .use(remarkGfm)
  .use(remarkAlert)
  .use(remarkMath)
  .use(remarkRehype)
  .use(rehypeRichEmbeds)
  .use(rehypeHeadingAnchors)
  .use(rehypeKatex, { strict: false, output: "html" })
  .use(rehypePrettyCode, {
    theme: atomOneDark,
    getHighlighter: (options) =>
      createHighlighter({ ...options, engine: createJavaScriptRegexEngine() }),
    defaultLang: { block: "plaintext" },
    keepBackground: false,
  })
  .use(enableLineNumbers)
  .use(rehypeStringify)

export type RenderMarkdownOptions = {
  /** リンクカードの OGP の引き方。省略すると src/data/ogp-cache.json だけを見る */
  resolveOgp?: OgpResolver
}

export async function renderMarkdown(
  markdown: string,
  options: RenderMarkdownOptions = {},
): Promise<string> {
  const data: RichEmbedsFileData = { resolveOgp: options.resolveOgp }
  return String(await processor.process({ value: markdown, data }))
}
