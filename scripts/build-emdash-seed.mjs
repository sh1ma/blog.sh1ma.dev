import { mkdir, readdir, readFile, writeFile } from "node:fs/promises"
import { basename, join } from "node:path"
import { parse as parseYaml } from "yaml"

const source = "src/markdown/posts"
const output = "seed/seed.json"

async function readPosts(locale) {
  const directory = locale === "en" ? join(source, "en") : source
  const files = (await readdir(directory)).filter((file) =>
    file.endsWith(".md"),
  )
  const posts = []

  for (const file of files) {
    const raw = await readFile(join(directory, file), "utf8")
    const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/)
    if (!match)
      throw new Error(`frontmatter がありません: ${directory}/${file}`)

    const metadata = parseYaml(match[1])
    const slug = basename(file, ".md")
    if (typeof metadata?.title !== "string" || !metadata.title) {
      throw new Error(`title がありません: ${directory}/${file}`)
    }
    if (
      typeof metadata.publishedAt !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(metadata.publishedAt)
    ) {
      throw new Error(`publishedAt が不正です: ${directory}/${file}`)
    }
    if (
      metadata.tags !== undefined &&
      (!Array.isArray(metadata.tags) ||
        metadata.tags.some((tag) => typeof tag !== "string"))
    ) {
      throw new Error(`tags が不正です: ${directory}/${file}`)
    }

    const filenamePriority = slug.match(/^\d{8}_(\d+)_/)
    const priority =
      metadata.priority ?? (filenamePriority ? Number(filenamePriority[1]) : 0)
    if (!Number.isInteger(priority))
      throw new Error(`priority が不正です: ${directory}/${file}`)

    posts.push({
      id: `${locale}-${slug}`,
      slug,
      locale,
      status: "published",
      data: {
        title: metadata.title,
        description: metadata.description ?? "",
        thumbnail: metadata.thumbnail ?? "",
        published_date: metadata.publishedAt,
        priority,
        tags: metadata.tags ?? [],
        markdown: match[2],
      },
    })
  }

  return posts
}

const japanese = await readPosts("ja")
const english = await readPosts("en")
const japaneseSlugs = new Set(japanese.map((post) => post.slug))
const englishWithLinks = english.map((post) =>
  japaneseSlugs.has(post.slug)
    ? { ...post, translationOf: `ja-${post.slug}` }
    : post,
)

const seed = {
  $schema: "https://emdashcms.com/seed.schema.json",
  version: "1",
  defaultLocale: "ja",
  meta: { name: "blog.sh1ma.dev", description: "既存ブログの記事" },
  settings: { title: "blog.sh1ma.dev", tagline: "sh1maのブログ" },
  collections: [
    {
      slug: "posts",
      label: "Articles",
      labelSingular: "Article",
      titleField: "title",
      urlPattern: "/articles/{slug}",
      routable: true,
      supports: ["drafts", "revisions", "preview", "search", "seo"],
      fields: [
        {
          slug: "title",
          label: "Title",
          type: "string",
          required: true,
          searchable: true,
        },
        { slug: "description", label: "Description", type: "text" },
        { slug: "thumbnail", label: "Thumbnail URL", type: "url" },
        {
          slug: "published_date",
          label: "Published date",
          type: "string",
          required: true,
          indexed: true,
        },
        {
          slug: "priority",
          label: "Sort priority",
          type: "integer",
          defaultValue: 0,
        },
        { slug: "tags", label: "Tags", type: "multiSelect" },
        {
          slug: "markdown",
          label: "Markdown body",
          type: "text",
          required: true,
          searchable: true,
          options: { rows: 24 },
        },
      ],
    },
  ],
  content: { posts: [...japanese, ...englishWithLinks] },
}

await mkdir("seed", { recursive: true })
await writeFile(output, `${JSON.stringify(seed, null, 2)}\n`)
console.log(
  `EmDash seed: ${japanese.length} ja + ${english.length} en = ${seed.content.posts.length} articles`,
)
