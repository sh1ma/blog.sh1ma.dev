/**
 * リンクカード (src/plugins/link-cards・src/admin/app/editor/link-card*.ts) の確認。
 * 手元用で CI では動かさない。Chromium と Firefox の両方で動かす (playwright.admin.config.ts)。
 *
 * 1〜4 は dev サーバーで動かす (data.db を書き換えるので seed し直した DB で):
 *
 *   rm -f data.db && pnpm exec emdash seed seed/seed.json --database data.db
 *   pnpm exec astro dev --config astro.test.config.mjs --host 127.0.0.1 --port 8799
 *   pnpm test:admin-editor e2e/link-card.admin.ts
 *
 * 2 は実在の公開ページ (github.com / developers.cloudflare.com) の OGP を取りに行く。
 *
 * 5 (公開ページの HTML が変更前と同じ) は、seed し直した DB で変更後のビルドを立て、
 * 変更前のビルドから取った HTML (tmp/lc/dump.mjs の出力) のディレクトリを渡したときだけ動く:
 *
 *   LINK_CARD_COMPARE_DIR=tmp/lc/html-before ADMIN_EDITOR_PORT=8811 \
 *     pnpm test:admin-editor e2e/link-card.admin.ts
 *
 * スクリーンショットは LINK_CARD_SHOTS_DIR (既定: test-results/link-card-shots) に保存する。
 */
import { readdir, readFile } from "node:fs/promises"
import { join } from "node:path"
import { DatabaseSync } from "node:sqlite"
import {
  type APIRequestContext,
  type Browser,
  expect,
  type Locator,
  type Page,
  test,
} from "@playwright/test"

const shotsDir =
  process.env.LINK_CARD_SHOTS_DIR ?? "test-results/link-card-shots"
const compareDir = process.env.LINK_CARD_COMPARE_DIR
const API = "/_emdash/api"
const ADMIN = "/_emdash/admin"

/** 既存記事のうちリンクカードのあるもの */
const EXISTING = "20260706_cloudflare_agentic_inbox"
/** 移行前の JSON にある URL (取りに行かない) */
const LEGACY_URL = "https://github.com/actions/runner/releases"
const LEGACY_TITLE = "Releases · actions/runner"

/** ブラウザごとに別の実在の URL を使う (どちらも初回は実際に取りに行く) */
const NEW_URL: Record<string, string> = {
  chromium: "https://github.com/withastro/astro",
  firefox: "https://github.com/cloudflare/workerd",
}
/** 保存時のフック (content:afterSave) だけで取らせる URL */
const HOOK_URL: Record<string, string> = {
  chromium: "https://developers.cloudflare.com/d1/",
  firefox: "https://developers.cloudflare.com/r2/",
}
const TWEET_URL = "https://x.com/sh1ma/status/1790000000000000000"
/** スラッシュコマンドで入れる URL (移行前の JSON にある) */
const SLASH_URL = "https://developers.cloudflare.com/containers/pricing/"
/** dev サーバー (astro.test.config.mjs) の DB */
const DB_PATH = process.env.LINK_CARD_DB ?? "data.db"

type Item = {
  id: string
  slug: string
  status: string
  updatedAt: string
  version: number
  data: { markdown: string; title: string }
}

type OgpLookup = {
  status: string
  source: string
  data: { title: string } | null
}

async function api<T>(
  request: APIRequestContext,
  path: string,
  init: { method?: string; data?: unknown } = {},
): Promise<T> {
  const response = await request.fetch(`${API}${path}`, {
    method: init.method ?? "GET",
    headers: { "X-EmDash-Request": "1", "Content-Type": "application/json" },
    data: init.data === undefined ? undefined : JSON.stringify(init.data),
  })
  const body = (await response.json()) as { data: T; error?: unknown }
  if (!response.ok())
    throw new Error(
      `${init.method ?? "GET"} ${path}: ${response.status()} ${JSON.stringify(body.error)}`,
    )
  return body.data
}

async function findPost(request: APIRequestContext, slug: string) {
  const { items } = await api<{ items: Item[] }>(
    request,
    "/content/posts?locale=ja&limit=100",
  )
  const post = items.find((item) => item.slug === slug)
  if (!post) throw new Error(`記事が見つかりません: ${slug}`)
  return post
}

async function getPost(request: APIRequestContext, id: string) {
  return api<{ item: Item; _rev: string }>(request, `/content/posts/${id}`)
}

function decodeHtml(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
}

type Card = { url: string; title: string; description: string; image: string }

/** 公開ページの HTML のリンクカード */
function publicCards(html: string): Card[] {
  return [
    ...html.matchAll(
      /<a href="([^"]*)" class="link-card"[^>]*>([\s\S]*?)<\/a>/g,
    ),
  ].map(([, href, inner]) => {
    const pick = (re: RegExp) => decodeHtml(inner.match(re)?.[1] ?? "")
    return {
      url: decodeHtml(href),
      title: pick(/class="link-card__title">([^<]*)</),
      description: pick(/class="link-card__desc">([^<]*)</),
      image: pick(/class="link-card__thumb"><img src="([^"]*)"/),
    }
  })
}

/** 編集画面のリンクカード (読み込みが終わってから) */
async function editorCards(page: Page): Promise<Card[]> {
  const cards = page.locator('[data-testid="link-card"][data-kind="ogp"]')
  await expect(cards.first()).toBeVisible({ timeout: 30_000 })
  await expect(
    page.locator('[data-testid="link-card"][data-state="loading"]'),
  ).toHaveCount(0, { timeout: 30_000 })
  return cards.evaluateAll((elements) =>
    elements.map((element) => ({
      url: (element as HTMLElement).dataset.url ?? "",
      title: element.querySelector(".bwa-linkcard__title")?.textContent ?? "",
      description:
        element.querySelector(".bwa-linkcard__desc")?.textContent ?? "",
      image:
        element
          .querySelector(".bwa-linkcard__thumb img")
          ?.getAttribute("src") ?? "",
    })),
  )
}

const body = (page: Page) => page.getByTestId("body-editor")
const saveStatus = (page: Page) => page.getByTestId("save-status")

async function expectSaved(page: Page) {
  await expect(saveStatus(page)).toHaveText("保存済み", { timeout: 30_000 })
}

/** カードを画面の中央に出して、画像の読み込みを待つ (スクリーンショット用) */
async function showCard(card: Locator) {
  await card.evaluate((element) => element.scrollIntoView({ block: "center" }))
  await expect
    .poll(() =>
      card.evaluate((element) =>
        [...element.querySelectorAll("img")].every((img) => img.complete),
      ),
    )
    .toBe(true)
}

/**
 * text をクリップボードに入れて、target をクリックしてから貼り付ける。
 * Firefox は合成した paste イベントの clipboardData を空にするので、
 * 一時的な textarea からキーボードで本当にコピー → 貼り付けする。
 */
async function paste(page: Page, text: string, target: Locator) {
  const source = await page.evaluateHandle((value) => {
    const textarea = document.createElement("textarea")
    textarea.value = value
    textarea.setAttribute("data-e2e-clipboard", "")
    document.body.appendChild(textarea)
    return textarea
  }, text)
  await source.asElement()?.focus()
  await page.keyboard.press("ControlOrMeta+A")
  await page.keyboard.press("ControlOrMeta+C")
  await source.evaluate((element) => element.remove())
  await target.click()
  await page.keyboard.press("ControlOrMeta+V")
}

test.describe.configure({ mode: "serial" })

test.describe("リンクカード (dev サーバー)", () => {
  test.skip(!!compareDir, "公開ページの比較だけを動かす")

  let browser: Browser
  let page: Page
  let shot: (name: string) => Promise<void>
  let browserName = ""
  let postId = ""
  let slug = ""

  test.beforeAll(async ({ browser: shared }, testInfo) => {
    browser = shared
    browserName = testInfo.project.name
    page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
    page.setDefaultTimeout(20_000)
    page.on("pageerror", (error) => console.log("pageerror:", error.message))
    shot = async (name) => {
      await page.screenshot({
        path: join(shotsDir, `${browserName}-${name}.png`),
      })
    }
    // 画面の配色は端末に合わせて決まるので、ページを開くたびにライトにそろえる
    await page.addInitScript(() =>
      localStorage.setItem("blog-admin-theme", "light"),
    )
    await page.goto(`${API}/setup/dev-bypass?content=0&redirect=${ADMIN}`)
  })

  test.afterAll(async () => {
    if (postId) {
      await api(page.request, `/content/posts/${postId}`, {
        method: "DELETE",
      }).catch(() => {})
    }
    await page.close()
  })

  test("1. 既存記事を開くと、公開ページと同じ内容のリンクカードが出る。開いただけでは値が変わらない", async () => {
    const post = await findPost(page.request, EXISTING)
    const before = await getPost(page.request, post.id)
    const writes: string[] = []
    page.on("request", (request) => {
      if (
        request.url().includes(`/content/posts/${post.id}`) &&
        request.method() === "PUT"
      )
        writes.push(`${request.method()} ${request.url()}`)
    })

    const expected = publicCards(
      await (await page.request.get(`/articles/${EXISTING}`)).text(),
    )
    expect(expected.length).toBeGreaterThanOrEqual(2)
    expect(
      expected.every((card) => card.image && card.title !== card.url),
    ).toBe(true)

    await page.goto(`${ADMIN}/posts/${post.id}`)
    await body(page).waitFor({ timeout: 120_000 })
    const actual = await editorCards(page)
    expect(actual).toEqual(expected)

    await showCard(page.locator('[data-testid="link-card"]').first())
    await shot("editor-card-light")
    await page.getByRole("button", { name: "ダークにする" }).click()
    await expect(page.locator("html")).toHaveAttribute(
      "data-admin-theme",
      "dark",
    )
    await shot("editor-card-dark")
    await page.getByRole("button", { name: "ライトにする" }).click()

    await page.waitForTimeout(3000)
    expect(writes).toEqual([])
    const after = await getPost(page.request, post.id)
    expect(after.item.data.markdown).toBe(before.item.data.markdown)
    expect(after.item.version).toBe(before.item.version)
    expect(after._rev).toBe(before._rev)
  })

  test("2. 新しい URL を空の段落に貼るとカードになり、保存・公開すると公開ページのカードに OGP が出る", async () => {
    const url = NEW_URL[browserName]
    await page.goto(ADMIN)
    await page.getByRole("link", { name: "新しい記事" }).click()
    await expect(page.locator(".bwa-title")).toBeFocused({ timeout: 30_000 })
    await page
      .locator(".bwa-title")
      .fill(`リンクカードのテスト (${browserName})`)
    slug = `${await page.locator("#prop-slug").inputValue()}e2e_link_card_${browserName}_${Date.now()}`
    await page.locator("#prop-slug").fill(slug)
    await body(page).click()
    await page.keyboard.type("リンクカードのテストです。")
    await page.keyboard.press("Enter")
    // 最初の保存で URL が /posts/<id> に変わるのを待ってから貼る
    await expect(page).toHaveURL(/\/_emdash\/admin\/posts\/[0-9A-Z]{26}$/, {
      timeout: 30_000,
    })
    await expectSaved(page)
    postId = page.url().split("/").pop() as string

    const fetched = page.waitForResponse(
      (response) =>
        response.url().includes("/plugins/link-cards/ogp?") &&
        response.url().includes(encodeURIComponent(url)),
    )
    await paste(page, url, body(page).locator("p").last())
    const card = page.locator(`[data-testid="link-card"][data-url="${url}"]`)
    await expect(card).toBeVisible()
    const lookup = (await (await fetched).json()).data as OgpLookup
    expect(lookup.status).toBe("ok")
    await expect(card).toHaveAttribute("data-state", "ok", { timeout: 30_000 })
    await expect(card.locator(".bwa-linkcard__title")).not.toHaveText(url)
    await expect(card.locator(".bwa-linkcard__thumb img")).toBeVisible()

    await expectSaved(page)
    // 保存される Markdown は「URL だけの段落」のまま
    expect((await getPost(page.request, postId)).item.data.markdown).toBe(
      `リンクカードのテストです。\n\n${url}\n`,
    )

    await page.getByRole("button", { name: /^公開/ }).click()
    await page.getByRole("menuitem", { name: /今すぐ公開/ }).click()
    await expect(page.locator(".bwa-props .bwa-state")).toHaveText("公開中", {
      timeout: 15_000,
    })
    const html = await (await page.request.get(`/articles/${slug}`)).text()
    const [published] = publicCards(html)
    expect(published.url).toBe(url)
    expect(published.title).toBe(lookup.data?.title)
    expect(published.title).not.toBe(url)
    expect(published.image).toMatch(/^https:\/\//)

    const viewer = await browser.newPage({
      viewport: { width: 1280, height: 900 },
    })
    await viewer.goto(`/articles/${slug}`)
    await expect(viewer.locator("a.link-card .link-card__title")).toHaveText(
      published.title,
    )
    await expect(
      viewer.locator("a.link-card .link-card__thumb img"),
    ).toBeVisible()
    await viewer.locator("a.link-card").scrollIntoViewIfNeeded()
    await viewer.screenshot({
      path: join(shotsDir, `${browserName}-new-url-public.png`),
    })
    await viewer.close()
  })

  test("2b. 保存時のフック (content:afterSave) が、まだ取っていない URL の OGP を保存する", async () => {
    const url = HOOK_URL[browserName]
    const created = await api<{ item: Item }>(page.request, "/content/posts", {
      method: "POST",
      data: {
        slug: `20991231_e2e_hook_${browserName}_${Date.now()}`,
        locale: "ja",
        data: {
          title: "フックの確認",
          published_date: "2099-12-31",
          markdown: `本文\n\n${url}\n`,
        },
      },
    })
    try {
      // API で問い合わせると API 自身が取りに行くので、プラグインのストレージを直接読む
      const db = new DatabaseSync(DB_PATH, { readOnly: true })
      try {
        const read = () =>
          db
            .prepare(
              "SELECT data FROM _plugin_storage WHERE plugin_id = 'link-cards' AND collection = 'ogp' AND id = ?",
            )
            .get(url) as { data: string } | undefined
        await expect
          .poll(() => read()?.data ?? null, {
            timeout: 30_000,
            intervals: [1000],
          })
          .not.toBeNull()
        const record = JSON.parse(read()?.data ?? "{}") as {
          data: { title: string; image?: string } | null
        }
        expect(record.data?.title).toBeTruthy()
        expect(record.data?.title).not.toBe(url)
      } finally {
        db.close()
      }
      const lookup = await api<OgpLookup>(
        page.request,
        `/plugins/link-cards/ogp?url=${encodeURIComponent(url)}`,
      )
      expect(lookup.source).toBe("stored")
    } finally {
      await api(page.request, `/content/posts/${created.item.id}`, {
        method: "DELETE",
      })
    }
  })

  test("3. X の投稿の URL を貼ると、X の投稿のカードになる", async () => {
    await paste(page, TWEET_URL, body(page).locator("p").last())
    const card = page.locator(`[data-testid="link-card"][data-kind="tweet"]`)
    await expect(card).toBeVisible()
    await expect(card).toContainText("@sh1ma")
    await expect(card).toContainText("1790000000000000000")
    await expect(card).toContainText("公開ページで埋め込み表示されます")
    await showCard(card)
    await shot("x-card")
    await expectSaved(page)
    expect((await getPost(page.request, postId)).item.data.markdown).toContain(
      `\n\n${TWEET_URL}\n`,
    )
  })

  test("3b. スラッシュコマンドの「リンクカード」で URL を入れるとカードになる", async () => {
    await body(page).locator("p").last().click()
    await page.keyboard.type("/")
    await expect(page.getByTestId("slash-menu")).toBeVisible()
    await page.keyboard.type("リンクカード")
    await page.keyboard.press("Enter")
    const dialog = page.getByRole("dialog", { name: "リンクカード" })
    await dialog.getByLabel("URL", { exact: true }).fill(SLASH_URL)
    await dialog.getByRole("button", { name: "挿入" }).click()
    const card = page.locator(
      `[data-testid="link-card"][data-url="${SLASH_URL}"]`,
    )
    await expect(card.locator(".bwa-linkcard__title")).toHaveText("Pricing")
    await expectSaved(page)
    expect((await getPost(page.request, postId)).item.data.markdown).toContain(
      `\n\n${SLASH_URL}\n`,
    )
  })

  test("4. カードの再取得・URL の変更・普通のリンクへの変換", async () => {
    const url = NEW_URL[browserName]
    const card = page.locator(`[data-testid="link-card"][data-url="${url}"]`)
    await card.click()
    const popover = page.getByTestId("link-card-popover")
    await expect(popover).toBeVisible()
    await expect(card).toHaveClass(/bwa-linkcard--selected/)

    // 再取得
    const refreshed = page.waitForResponse(
      (response) =>
        response.url().endsWith("/plugins/link-cards/ogp/refresh") &&
        response.request().method() === "POST",
    )
    await popover.getByRole("button", { name: "再取得" }).click()
    expect((await refreshed).status()).toBe(200)
    await expect(popover.locator(".bwa-linkcard-pop__status")).toContainText(
      "に取得",
    )

    // URL の変更
    const input = popover.getByLabel("リンクカードの URL")
    await expect(input).toHaveValue(url)
    await input.fill(LEGACY_URL)
    await shot("url-edit-popover")
    await popover.getByRole("button", { name: "変更" }).click()
    const changed = page.locator(
      `[data-testid="link-card"][data-url="${LEGACY_URL}"]`,
    )
    await expect(changed.locator(".bwa-linkcard__title")).toHaveText(
      LEGACY_TITLE,
    )
    await expect(card).toHaveCount(0)
    await expectSaved(page)
    let markdown = (await getPost(page.request, postId)).item.data.markdown
    expect(markdown).toContain(`\n\n${LEGACY_URL}\n`)
    expect(markdown).not.toContain(url)

    // 普通のリンクにする
    await changed.click()
    await expect(popover).toBeVisible()
    await popover.getByRole("button", { name: "普通のリンクにする" }).click()
    await expect(changed).toHaveCount(0)
    await expect(body(page).locator(`a[href="${LEGACY_URL}"]`)).toHaveText(
      LEGACY_TITLE,
    )
    await expectSaved(page)
    markdown = (await getPost(page.request, postId)).item.data.markdown
    expect(markdown).toContain(`\n\n[${LEGACY_TITLE}](${LEGACY_URL})\n`)
    // X の投稿のカードはそのまま
    expect(markdown).toContain(`\n\n${TWEET_URL}\n`)

    // … メニューの「リンクカードを再取得」(残っているのはスラッシュコマンドで入れた 1 件)
    await page.getByRole("button", { name: "その他の操作" }).click()
    const refreshedAll = page.waitForResponse(
      (response) =>
        response.url().endsWith("/plugins/link-cards/ogp/refresh") &&
        response.request().postData()?.includes(SLASH_URL) === true,
    )
    await page.getByRole("menuitem", { name: "リンクカードを再取得" }).click()
    expect((await refreshedAll).status()).toBe(200)
    await expect(
      page.getByText("1 件のリンクカードを取り直しました"),
    ).toBeVisible()
  })
})

test.describe("リンクカード (公開ページの比較)", () => {
  test.skip(!compareDir, "LINK_CARD_COMPARE_DIR を渡したときだけ")

  const normalize = (html: string) =>
    html
      .replace(/\/_astro\/[^"'\s)]+/g, "/_astro/X")
      .replace(/\buid="[^"]*"/g, 'uid=""')
      .replace(/\bprefix="[^"]*"/g, 'prefix=""')

  test("5. 既存記事の公開ページの HTML が変更前と一致する", async ({
    page,
    request,
  }) => {
    const dir = compareDir as string
    const files = (await readdir(dir)).filter((name) => name.endsWith(".html"))
    expect(files.length).toBe(48)
    let cards = 0
    for (const file of files) {
      const [, locale, slug] = file.match(/^(ja|en)-(.+)\.html$/) ?? []
      const path = `${locale === "en" ? "/en" : ""}/articles/${encodeURIComponent(slug)}`
      const response = await request.get(path)
      expect(response.status(), path).toBe(200)
      const after = normalize(await response.text())
      const before = await readFile(join(dir, file), "utf8")
      expect(after, path).toBe(before)
      cards += publicCards(after).length
    }
    expect(cards).toBeGreaterThanOrEqual(24)

    // ブラウザでもカードが描かれる
    await page.goto(`/articles/${EXISTING}`)
    await expect(page.locator("a.link-card").first()).toBeVisible()
    await expect(
      page.locator("a.link-card .link-card__thumb img").first(),
    ).toBeVisible()
  })
})
