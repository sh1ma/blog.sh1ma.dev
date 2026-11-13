/**
 * 管理画面の Markdown WYSIWYG エディタの確認 (手元用。CI では動かさない)。
 *
 * ローカルの data.db を書き換えるので、毎回 seed し直した DB で動かす:
 *
 *   pnpm build:seed
 *   pnpm exec emdash secrets generate --write .env   # .env が無いときだけ
 *   rm -f data.db && pnpm exec emdash seed seed/seed.json --database data.db
 *   pnpm exec astro dev --config astro.test.config.mjs --host 127.0.0.1 --port 8799
 *   pnpm test:admin-editor
 *
 * スクリーンショットは WYSIWYG_SHOTS_DIR (既定: test-results/markdown-editor-shots) に保存する。
 */
import { type Browser, expect, type Page, test } from "@playwright/test"

const shotsDir =
  process.env.WYSIWYG_SHOTS_DIR ?? "test-results/markdown-editor-shots"
const API = "/_emdash/api"

/** 既存記事を開く・追記するテストに使う記事 (表・脚注・コードを含む) */
const EDIT_SLUG = "20260720_1_cloudflare_containers_github_self_hosted_runners"
/** 書式の入力・ソース編集・画像に使う記事 */
const FORMAT_SLUG = "20240108_from_asdf_to_mise"
/** 開いただけで値が変わらないことを確かめる記事 (書式の違うものを選ぶ) */
const OPEN_ONLY_SLUGS = [
  "20230102_helloworld",
  "20260706_mise_age_encrypt_env",
  "20260705_k3s_on_cloudflare_workers",
  "20260710_1_cloudflare_r2_macos_finder",
]

type Post = {
  id: string
  slug: string
  locale: string
  data: { markdown: string; thumbnail?: string }
}

async function login(page: Page) {
  // セットアップ済みにして dev 用の管理者でログインする (import.meta.env.DEV のときだけ有効)
  await page.goto(`${API}/setup/dev-bypass?content=0&redirect=/_emdash/admin`)
}

async function api<T>(page: Page, path: string): Promise<T> {
  const response = await page.request.get(`${API}${path}`, {
    headers: { "X-EmDash-Request": "1" },
  })
  expect(response.ok()).toBe(true)
  return ((await response.json()) as { data: T }).data
}

async function findPost(page: Page, slug: string, locale = "ja") {
  const { items } = await api<{ items: Post[] }>(
    page,
    `/content/posts?locale=${locale}&limit=100`,
  )
  const post = items.find((item) => item.slug === slug)
  if (!post) throw new Error(`記事が見つかりません: ${slug}`)
  return post
}

async function getMarkdown(page: Page, id: string) {
  return (await api<{ item: Post }>(page, `/content/posts/${id}`)).item.data
    .markdown
}

const editor = (page: Page) =>
  page.locator("[data-markdown-editor] .ProseMirror")

async function openPost(page: Page, id: string) {
  await page.goto(`/_emdash/admin/content/posts/${id}`)
  await editor(page).waitFor({ timeout: 120_000 })
  const welcome = page.getByRole("button", { name: "Get Started" })
  if (await welcome.isVisible().catch(() => false)) await welcome.click()
}

/** 管理画面の保存ボタンが「Saved」(未保存の変更なし) か */
async function expectClean(page: Page) {
  await page.waitForTimeout(1500)
  await expect(
    page.getByRole("button", { name: "Save", exact: true }),
  ).toHaveCount(0)
  await expect(
    page.getByRole("button", { name: "Saved", exact: true }).first(),
  ).toBeVisible()
}

async function save(page: Page) {
  await page.getByRole("button", { name: "Save", exact: true }).click()
  await expect(
    page.getByRole("button", { name: "Saved", exact: true }).first(),
  ).toBeVisible({ timeout: 30_000 })
}

/** 下書きの変更を公開する (確認ダイアログあり) */
async function publish(page: Page) {
  await page.getByRole("button", { name: "Publish changes" }).first().click()
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Publish changes" })
    .click()
  await expect(
    page.getByRole("button", { name: "Publish changes" }),
  ).toHaveCount(0, { timeout: 30_000 })
}

/** 既存記事は thumbnail が空文字で、管理画面の検証で保存できない (既存の問題)。テストでは URL を入れて回避する */
async function fillThumbnail(page: Page) {
  const thumbnail = page.locator("#field-thumbnail")
  if (!(await thumbnail.inputValue())) {
    await thumbnail.fill("https://blog.sh1ma.dev/og/test.png")
  }
}

/** Tiptap のエディタを使ってカーソルを置く (DOM の要素に editor が付いている) */
async function placeCaret(page: Page, where: "firstParagraphEnd" | "docEnd") {
  await editor(page).locator("p").first().click()
  await page.evaluate((target) => {
    const element = document.querySelector(
      "[data-markdown-editor] .ProseMirror",
    ) as HTMLElement & {
      editor: {
        state: {
          doc: {
            content: { size: number }
            forEach: (
              fn: (
                node: { type: { name: string }; nodeSize: number },
                offset: number,
              ) => void,
            ) => void
          }
        }
        commands: { setTextSelection: (pos: number) => void; focus: () => void }
      }
    }
    const { editor: tiptap } = element
    let position = tiptap.state.doc.content.size
    if (target === "firstParagraphEnd") {
      let found = -1
      tiptap.state.doc.forEach((node, offset) => {
        if (found < 0 && node.type.name === "paragraph") {
          found = offset + node.nodeSize - 1
        }
      })
      position = found
    }
    tiptap.commands.setTextSelection(position)
    tiptap.commands.focus()
  }, where)
  await page.waitForTimeout(200)
}

/** 2 つの文字列の違いを「共通の前後を除いた部分」で表す */
function diff(before: string, after: string) {
  let start = 0
  while (
    start < before.length &&
    start < after.length &&
    before[start] === after[start]
  )
    start++
  let end = 0
  while (
    end < before.length - start &&
    end < after.length - start &&
    before[before.length - 1 - end] === after[after.length - 1 - end]
  )
    end++
  return {
    at: start,
    removed: before.slice(start, before.length - end),
    added: after.slice(start, after.length - end),
  }
}

async function articleBody(page: Page, slug: string) {
  await page.goto(`/articles/${slug}`)
  return page.locator("article main.prose").innerHTML()
}

/** 1x1 の PNG */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
)

test.describe.configure({ mode: "serial" })

let browser: Browser
let page: Page

test.beforeAll(async ({ browser: shared }) => {
  browser = shared
  page = await browser.newPage({ viewport: { width: 1400, height: 1000 } })
  await login(page)
})

test.afterAll(async () => {
  await page.close()
})

test("1. 既存記事を開くと WYSIWYG が出て、開いただけでは未保存にならない", async () => {
  const post = await findPost(page, EDIT_SLUG)
  const before = await getMarkdown(page, post.id)
  await openPost(page, post.id)

  await expect(page.locator("textarea#field-markdown")).toHaveCount(0)
  await expect(editor(page)).toBeVisible()
  await expect(editor(page).locator("table").first()).toBeVisible()
  await expect(
    editor(page).locator("sup[data-footnote-reference]").first(),
  ).toBeVisible()
  await expectClean(page)
  expect(await getMarkdown(page, post.id)).toBe(before)

  await page.screenshot({ path: `${shotsDir}/01-wysiwyg.png` })
  await page
    .locator(".md-toolbar")
    .screenshot({ path: `${shotsDir}/02-toolbar.png` })

  for (const slug of OPEN_ONLY_SLUGS) {
    const other = await findPost(page, slug)
    const markdown = await getMarkdown(page, other.id)
    await openPost(page, other.id)
    await expectClean(page)
    expect(await getMarkdown(page, other.id)).toBe(markdown)
  }
})

test("2. 段落に文字を足して保存すると、足した文字以外は元のまま", async () => {
  const post = await findPost(page, EDIT_SLUG)
  const before = await getMarkdown(page, post.id)
  const publicBefore = await articleBody(page, EDIT_SLUG)

  await openPost(page, post.id)
  await fillThumbnail(page)
  await placeCaret(page, "firstParagraphEnd")
  await page.keyboard.type("（追記）")
  await save(page)

  const after = await getMarkdown(page, post.id)
  const change = diff(before, after)
  console.log("2. 差分:", JSON.stringify(change))
  expect(change.removed).toBe("")
  expect(change.added).toBe("（追記）")
  expect(after.replace("（追記）", "")).toBe(before)

  // 6. 公開すると、公開ページの本文は追記した文字以外は変わらない
  await publish(page)
  const publicAfter = await articleBody(page, EDIT_SLUG)
  expect(publicAfter).not.toBe(publicBefore)
  expect(publicAfter.replace("（追記）", "")).toBe(publicBefore)

  // 追記を消して公開し直すと、公開ページは元とまったく同じ
  await openPost(page, post.id)
  for (let i = 0; i < "（追記）".length; i++) {
    if (i === 0) await placeCaret(page, "firstParagraphEnd")
    await page.keyboard.press("Backspace")
  }
  await save(page)
  expect(await getMarkdown(page, post.id)).toBe(before)
  await publish(page)
  expect(await articleBody(page, EDIT_SLUG)).toBe(publicBefore)
})

test("3. 見出し・太字・リスト・コード・数式・表を入力して保存すると期待した Markdown になる", async () => {
  const post = await findPost(page, FORMAT_SLUG)
  const before = await getMarkdown(page, post.id)
  await openPost(page, post.id)
  await fillThumbnail(page)
  await placeCaret(page, "docEnd")

  const keyboard = page.keyboard
  await keyboard.press("Enter")
  await keyboard.type("## 見出しテスト")
  await keyboard.press("Enter")
  await keyboard.type("**太字**")
  await keyboard.type(" と *斜体* と `code` と数式 $E=mc^2$ です")
  await keyboard.press("Enter")
  await keyboard.type("- 項目1")
  await keyboard.press("Enter")
  await keyboard.type("項目2")
  await keyboard.press("Enter")
  await keyboard.press("Enter")
  await keyboard.type("```ts ")
  await keyboard.type("const a = 1")
  await keyboard.press("Enter")
  await keyboard.press("Enter")
  await keyboard.press("Enter")

  await page.getByRole("button", { name: "数式ブロック ($$...$$)" }).click()
  await page.getByRole("textbox", { name: /LaTeX/ }).fill("\\int_0^1 x\\,dx")
  await page.getByRole("button", { name: "適用" }).click()

  await page.getByRole("button", { name: "表を挿入" }).click()
  for (const cell of ["列A", "列B", "列C", "1", "2", "3"]) {
    await keyboard.type(cell)
    await keyboard.press("Tab")
  }
  await save(page)

  const after = await getMarkdown(page, post.id)
  const change = diff(before, after)
  console.log("3. 追加された Markdown:\n", change.added)
  expect(change.removed).toBe("")
  expect(after.startsWith(before.replace(/\n+$/, ""))).toBe(true)
  expect(change.added).toContain("## 見出しテスト")
  expect(change.added).toContain(
    "**太字** と *斜体* と `code` と数式 $E=mc^2$ です",
  )
  expect(change.added).toContain("- 項目1\n- 項目2")
  expect(change.added).toContain("```ts\nconst a = 1\n```")
  expect(change.added).toContain("$$\n\\int_0^1 x\\,dx\n$$")
  expect(change.added).toMatch(
    /\| 列A +\| 列B +\| 列C +\|\n\| -+ \| -+ \| -+ \|\n\| 1 +\| 2 +\| 3 +\|/,
  )
  await page.screenshot({ path: `${shotsDir}/03-formats.png` })
})

test("4. ソース表示で編集して WYSIWYG に戻すと反映される", async () => {
  const post = await findPost(page, FORMAT_SLUG)
  await openPost(page, post.id)
  await page.getByRole("button", { name: "Markdown", exact: true }).click()
  const source = page.locator("textarea.md-source")
  await expect(source).toBeVisible()
  expect(await source.inputValue()).toBe(await getMarkdown(page, post.id))
  await page.screenshot({ path: `${shotsDir}/04-source.png` })

  await source.click()
  await page.keyboard.press("Control+End")
  await page.keyboard.type("\nソースから追加した **段落**\n")
  await page.getByRole("button", { name: "WYSIWYG", exact: true }).click()
  await expect(
    editor(page)
      .locator("p", { hasText: "ソースから追加した" })
      .locator("strong"),
  ).toHaveText("段落")
  await fillThumbnail(page)
  await save(page)
  expect(await getMarkdown(page, post.id)).toContain(
    "ソースから追加した **段落**",
  )

  // もう一度切り替えても内容は失われない
  const saved = await getMarkdown(page, post.id)
  await page.getByRole("button", { name: "Markdown", exact: true }).click()
  expect(await source.inputValue()).toBe(saved)
  await page.getByRole("button", { name: "WYSIWYG", exact: true }).click()
  await expectClean(page)
})

test("5. 画像をアップロードして挿入できる (ボタン / ドロップ)", async () => {
  const post = await findPost(page, FORMAT_SLUG)
  await openPost(page, post.id)
  await placeCaret(page, "docEnd")
  await page.getByRole("button", { name: "画像", exact: true }).click()
  await page
    .locator('input[type="file"][aria-label="アップロードする画像"]')
    .setInputFiles({
      name: "upload-test.png",
      mimeType: "image/png",
      buffer: PNG,
    })
  const image = editor(page).locator('img[alt="upload-test"]')
  await expect(image).toBeVisible({ timeout: 30_000 })
  const src = await image.getAttribute("src")
  expect(src).toMatch(/^\/_emdash\/api\/media\/file\//)

  // ドラッグ & ドロップ
  await page.evaluate((base64) => {
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
    const transfer = new DataTransfer()
    transfer.items.add(new File([bytes], "dropped.png", { type: "image/png" }))
    const target = document.querySelector(
      "[data-markdown-editor] .ProseMirror p",
    ) as HTMLElement
    const rect = target.getBoundingClientRect()
    target.dispatchEvent(
      new DragEvent("drop", {
        bubbles: true,
        cancelable: true,
        dataTransfer: transfer,
        clientX: rect.left + 5,
        clientY: rect.top + 5,
      }),
    )
  }, PNG.toString("base64"))
  await expect(editor(page).locator('img[alt="dropped"]')).toBeVisible({
    timeout: 30_000,
  })

  await fillThumbnail(page)
  await save(page)
  const markdown = await getMarkdown(page, post.id)
  expect(markdown).toContain(`![upload-test](${src})`)
  expect(markdown).toMatch(/!\[dropped\]\(\/_emdash\/api\/media\/file\/[^)]+\)/)
  const file = await page.request.get(src!)
  expect(file.status()).toBe(200)
  expect(file.headers()["content-type"]).toContain("image/png")
})

test("IME (日本語入力の変換中) で壊れない", async () => {
  const post = await findPost(page, FORMAT_SLUG)
  const before = await getMarkdown(page, post.id)
  await openPost(page, post.id)
  await placeCaret(page, "firstParagraphEnd")

  // 変換中 (未確定) の文字列を出してから確定する。CDP で IME の入力を再現する
  const cdp = await page.context().newCDPSession(page)
  for (const composing of ["に", "にほ", "にほんご"]) {
    await cdp.send("Input.imeSetComposition", {
      text: composing,
      selectionStart: composing.length,
      selectionEnd: composing.length,
    })
  }
  await cdp.send("Input.insertText", { text: "日本語" })
  await page.keyboard.type("を")
  await cdp.detach()

  await expect(editor(page).locator("p").first()).toContainText("日本語を")
  await expect(editor(page).locator("p").first()).not.toContainText("にほんご")
  await fillThumbnail(page)
  await save(page)
  const change = diff(before, await getMarkdown(page, post.id))
  expect(change).toMatchObject({ removed: "", added: "日本語を" })
})

test("スクリーンショット: ダークモード / スマホ幅", async () => {
  const post = await findPost(page, EDIT_SLUG)
  await openPost(page, post.id)
  await page.getByRole("button", { name: "Switch to dark" }).click()
  await page.locator(".md-editor").scrollIntoViewIfNeeded()
  await page.screenshot({ path: `${shotsDir}/05-dark.png` })
  await page.getByRole("button", { name: "Markdown", exact: true }).click()
  await page.screenshot({ path: `${shotsDir}/06-dark-source.png` })
  await page.getByRole("button", { name: "WYSIWYG", exact: true }).click()
  await page.getByRole("button", { name: /Switch to light/ }).click()

  const mobile = await browser.newPage({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  })
  await login(mobile)
  await openPost(mobile, post.id)
  await mobile.locator(".md-editor").scrollIntoViewIfNeeded()
  await mobile.screenshot({ path: `${shotsDir}/07-mobile-390.png` })
  await mobile.close()
})
