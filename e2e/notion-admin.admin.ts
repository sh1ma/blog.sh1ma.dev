/**
 * 自前の管理画面 (src/admin) の確認 (手元用。CI では動かさない)。
 *
 * ローカルの data.db を書き換えるので、毎回 seed し直した DB で動かす:
 *
 *   pnpm build:seed
 *   pnpm exec emdash secrets generate --write .env   # .env が無いときだけ
 *   rm -f data.db && pnpm exec emdash seed seed/seed.json --database data.db
 *   pnpm exec astro dev --config astro.test.config.mjs --host 127.0.0.1 --port 8799
 *   pnpm test:admin-editor e2e/notion-admin.admin.ts
 *
 * 9 (公開ページの HTML が変わっていないこと) は、変更前と変更後のビルドを別ポートで立てて
 * COMPARE_BEFORE_URL / COMPARE_AFTER_URL を渡したときだけ動く。
 * スクリーンショットは ADMIN_SHOTS_DIR (既定: test-results/notion-admin-shots) に保存する。
 */
import { readFile } from "node:fs/promises"
import {
  type APIRequestContext,
  type Browser,
  expect,
  type Locator,
  type Page,
  test,
} from "@playwright/test"

const shotsDir =
  process.env.ADMIN_SHOTS_DIR ?? "test-results/notion-admin-shots"
const API = "/_emdash/api"
const ADMIN = "/_emdash/admin"

type Item = {
  id: string
  slug: string
  locale: string
  status: string
  version: number
  updatedAt: string
  draftRevisionId: string | null
  liveRevisionId: string | null
  data: Record<string, unknown> & {
    markdown: string
    title: string
    tags?: string[]
  }
}

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
)

/** 中身の違う PNG を作る (同じ中身だと EmDash が重複として同じメディアを返すため) */
function pngVariant(seed: number) {
  // tEXt チャンクを足すと中身 (ハッシュ) が変わる。CRC は検査されないブラウザ向けに 0 で埋める
  const text = Buffer.from(`tEXtc\u0000${seed}-${Date.now()}`, "latin1")
  const length = Buffer.alloc(4)
  length.writeUInt32BE(text.length - 4)
  const iend = PNG.subarray(PNG.length - 12)
  return Buffer.concat([
    PNG.subarray(0, PNG.length - 12),
    length,
    text,
    Buffer.alloc(4),
    iend,
  ])
}

async function shot(page: Page, name: string) {
  await page.screenshot({ path: `${shotsDir}/${name}.png` })
}

async function login(page: Page) {
  // セットアップ済みにして dev 用の管理者でログインする (import.meta.env.DEV のときだけ有効)
  await page.goto(`${API}/setup/dev-bypass?content=0&redirect=${ADMIN}`)
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

async function findPost(
  request: APIRequestContext,
  slug: string,
  locale = "ja",
) {
  const { items } = await api<{ items: Item[] }>(
    request,
    `/content/posts?locale=${locale}&limit=100`,
  )
  const post = items.find((item) => item.slug === slug)
  if (!post) throw new Error(`記事が見つかりません: ${slug}`)
  return post
}

async function getPost(request: APIRequestContext, id: string) {
  return api<{ item: Item; _rev: string }>(request, `/content/posts/${id}`)
}

const body = (page: Page) => page.getByTestId("body-editor")
const saveStatus = (page: Page) => page.getByTestId("save-status")

async function openEditor(page: Page, id: string) {
  await page.goto(`${ADMIN}/posts/${id}`)
  await body(page).waitFor({ timeout: 120_000 })
}

async function expectSaved(page: Page) {
  await expect(saveStatus(page)).toHaveText("保存済み", { timeout: 30_000 })
}

/** ブロックにマウスを乗せて左のハンドルを出す */
async function hoverBlock(page: Page, block: Locator) {
  await block.hover({ position: { x: 20, y: 8 } })
  await expect(page.getByTestId("block-handle")).toBeVisible()
}

async function slash(page: Page, query: string) {
  await page.keyboard.type("/")
  await expect(page.getByTestId("slash-menu")).toBeVisible()
  await page.keyboard.type(query)
  await page.keyboard.press("Enter")
}

async function publicHtml(request: APIRequestContext, path: string) {
  const response = await request.get(path)
  return { status: response.status(), text: await response.text() }
}

test.describe.configure({ mode: "serial" })

test.describe("管理画面 (dev サーバー)", () => {
  let browser: Browser
  let page: Page

  test.beforeAll(async ({ browser: shared }) => {
    browser = shared
    page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    page.setDefaultTimeout(20_000)
    page.on("pageerror", (error) => console.log("pageerror:", error.message))
    await login(page)
  })

  test.afterAll(async () => {
    await page.close()
  })

  test("1. ルーティング: 未ログインはログインへ、ログイン後は新しい一覧。device / login は EmDash のまま。逃げ道", async () => {
    const anonymous = await browser.newContext()
    const anon = await anonymous.newPage()
    await anon.goto(ADMIN)
    await expect(anon).toHaveURL(
      /\/_emdash\/admin\/login\?redirect=%2F_emdash%2Fadmin/,
    )
    // 編集画面のパスも redirect 付きでログインへ
    await anon.goto(`${ADMIN}/posts/abc`)
    await expect(anon).toHaveURL(
      /login\?redirect=%2F_emdash%2Fadmin%2Fposts%2Fabc/,
    )
    // ログイン画面は EmDash の SPA のまま
    const loginHtml = await (await anon.request.get(`${ADMIN}/login`)).text()
    expect(loginHtml).toContain("emdash-boot-loader")
    expect(loginHtml).not.toContain('data-admin="notion"')
    await anonymous.close()

    // ログイン後の一覧
    const response = await page.goto(ADMIN)
    expect(await response?.text()).toContain('data-admin="notion"')
    expect(response?.headers()["cache-control"]).toBe("private, no-store")
    expect(response?.headers()["x-robots-tag"]).toContain("noindex")
    await expect(
      page.getByRole("heading", { name: "記事", level: 1 }),
    ).toBeVisible()
    await expect(page.locator("meta[name=robots]")).toHaveAttribute(
      "content",
      /noindex/,
    )
    await expect(page.locator(".ad-table tbody tr")).toHaveCount(48)
    await shot(page, "01-list-light")

    // デバイスフローの承認ページ・設定は EmDash のまま
    for (const path of ["/device", "/settings", "/content/posts"]) {
      const html = await (await page.request.get(`${ADMIN}${path}`)).text()
      expect(html, path).toContain("emdash-boot-loader")
      expect(html, path).not.toContain('data-admin="notion"')
    }
    await page.goto(`${ADMIN}/device`)
    await expect(page.locator(".ad-shell")).toHaveCount(0)

    // 逃げ道: ?classic=1 で元の SPA
    for (const path of ["", "/media", "/tags"]) {
      const html = await (
        await page.request.get(`${ADMIN}${path}?classic=1`)
      ).text()
      expect(html, path).toContain("emdash-boot-loader")
      expect(html, path).not.toContain('data-admin="notion"')
    }
    await page.goto(`${ADMIN}?classic=1`)
    await expect(page.locator(".ad-shell")).toHaveCount(0)
    await shot(page, "19-classic-dashboard")
    // 元の SPA の記事編集 (本文ウィジェット) も開ける
    const post = await findPost(page.request, "20230102_helloworld")
    await page.goto(`${ADMIN}/content/posts/${post.id}`)
    await expect(
      page.locator("[data-markdown-editor] .ProseMirror"),
    ).toBeVisible({ timeout: 120_000 })
    await expect(page.locator(".ad-shell")).toHaveCount(0)
  })

  test("2. 既存記事を開いただけでは保存されない", async () => {
    const post = await findPost(
      page.request,
      "20260720_1_cloudflare_containers_github_self_hosted_runners",
    )
    const before = await getPost(page.request, post.id)
    const writes: string[] = []
    page.on("request", (request) => {
      if (
        request.url().includes(`/content/posts/${post.id}`) &&
        request.method() === "PUT"
      )
        writes.push(request.url())
    })
    await openEditor(page, post.id)
    await expect(page.locator(".ad-title")).toHaveValue(before.item.data.title)
    await expect(page.getByTestId("save-status")).toHaveText("")
    await page.waitForTimeout(4000)
    await shot(page, "02-editor-open")
    expect(writes).toEqual([])
    const after = await getPost(page.request, post.id)
    expect(after.item.data.markdown).toBe(before.item.data.markdown)
    expect(after.item.updatedAt).toBe(before.item.updatedAt)
    expect(after.item.version).toBe(before.item.version)
    expect(after._rev).toBe(before._rev)
    // 別の記事に移ってもやはり書かない
    await page.goto(ADMIN)
    expect(writes).toEqual([])
  })

  test("3. タイトル・プロパティ・本文を編集すると自動保存される", async () => {
    const post = await findPost(page.request, "20240108_from_asdf_to_mise")
    const original = (await getPost(page.request, post.id)).item.data
    await openEditor(page, post.id)

    // タイトル
    const title = page.locator(".ad-title")
    await title.click()
    await page.keyboard.press("End")
    await page.keyboard.type(" (編集)")

    // 説明・タグ
    await page.locator("#prop-description").fill("E2E で書いた説明")
    await page.getByRole("button", { name: "タグを追加" }).click()
    await page
      .getByRole("textbox", { name: "タグを検索・作成" })
      .fill("E2Eタグ")
    await page.keyboard.press("Enter")
    await page.keyboard.press("Escape")
    await expect(page.getByTestId("tag-input")).toContainText("E2Eタグ")

    // 本文: 最後のブロックの「＋」から見出し・箇条書き・コード・アラート・数式・表を足す
    const blocks = body(page).locator(":scope > *")
    await hoverBlock(page, blocks.last())
    await shot(page, "05-block-handle")
    await page.getByRole("button", { name: "下にブロックを追加" }).click()
    await expect(page.getByTestId("slash-menu")).toBeVisible()
    await shot(page, "03-slash-menu")
    await page.keyboard.type("h2")
    await page.keyboard.press("Enter")
    await page.keyboard.type("E2E 見出し")
    await page.keyboard.press("Enter")

    await slash(page, "箇条")
    await page.keyboard.type("項目1")
    await page.keyboard.press("Enter")
    await page.keyboard.type("項目2")
    await page.keyboard.press("Enter")
    await page.keyboard.press("Enter")

    await slash(page, "code")
    await page.keyboard.type("const e2e = 1")
    await page.keyboard.press("Enter")
    await page.keyboard.press("Enter")
    await page.keyboard.press("Enter")

    await slash(page, "warn")
    await page.keyboard.type("注意してね")
    await page.keyboard.press("Enter")
    await page.keyboard.press("Enter")

    await slash(page, "数式")
    await page.getByRole("textbox", { name: "LaTeX" }).fill("a^2+b^2=c^2")
    await page.getByRole("button", { name: "決定" }).click()

    await page.keyboard.type("移動A")
    await page.keyboard.press("Enter")
    await page.keyboard.type("移動B")
    await page.keyboard.press("Enter")

    await slash(page, "表")
    await page.keyboard.type("A")
    await page.keyboard.press("Tab")
    await page.keyboard.type("B")

    // 選択ツールバー
    const moveA = body(page).locator("p", { hasText: "移動A" })
    await moveA.click()
    await page.keyboard.press("End")
    await page.keyboard.press("Shift+Home")
    await expect(page.getByTestId("bubble-toolbar")).toBeVisible()
    await shot(page, "04-bubble-toolbar")
    await page.getByRole("button", { name: "太字 (⌘B)" }).click()
    await expect(
      body(page).locator("strong", { hasText: "移動A" }),
    ).toBeVisible()
    // 選択を解いてツールバーを閉じる
    await page.keyboard.press("End")
    await expect(page.getByTestId("bubble-toolbar")).toBeHidden()

    // ドラッグで「移動B」を「移動A」の上へ
    const moveB = body(page).locator("p", { hasText: "移動B" })
    await hoverBlock(page, moveB)
    const handle = page.getByRole("button", {
      name: "ブロックのメニュー (ドラッグで移動)",
    })
    const from = await handle.boundingBox()
    const to = await body(page).locator("p", { hasText: "移動A" }).boundingBox()
    if (!from || !to) throw new Error("ドラッグの位置が取れません")
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
    await page.mouse.down()
    await page.mouse.move(from.x + 40, from.y - 10, { steps: 5 })
    await page.mouse.move(to.x + 10, to.y + 2, { steps: 10 })
    await page.mouse.up()
    await expect(body(page).locator("p", { hasText: "移動B" })).toBeVisible()

    // 画像の貼り付け
    await body(page).locator("p", { hasText: "移動A" }).click()
    await page.keyboard.press("End")
    await body(page).evaluate(
      (element, bytes) => {
        const file = new File([new Uint8Array(bytes)], "paste-e2e.png", {
          type: "image/png",
        })
        const data = new DataTransfer()
        data.items.add(file)
        element.dispatchEvent(
          new ClipboardEvent("paste", {
            clipboardData: data,
            bubbles: true,
            cancelable: true,
          }),
        )
      },
      [...pngVariant(1)],
    )
    await expect(body(page).locator("img[alt='paste-e2e']")).toBeVisible({
      timeout: 30_000,
    })

    await expectSaved(page)
    const saved = (await getPost(page.request, post.id)).item.data
    expect(saved.title).toBe(`${original.title} (編集)`)
    expect(saved.description).toBe("E2E で書いた説明")
    expect(saved.tags).toEqual([
      ...((original.tags as string[]) ?? []),
      "E2Eタグ",
    ])
    const markdown = saved.markdown
    // 触っていないブロックは元の文字列のまま
    expect(markdown.startsWith(original.markdown.replace(/\n+$/, ""))).toBe(
      true,
    )
    const added = markdown.slice(original.markdown.replace(/\n+$/, "").length)
    expect(added).toContain("## E2E 見出し")
    expect(added).toMatch(/- 項目1\n- 項目2/)
    expect(added).toContain("```\nconst e2e = 1\n```")
    expect(added).toContain("> [!WARNING]\n> 注意してね")
    expect(added).toContain("$$\na^2+b^2=c^2\n$$")
    expect(added).toMatch(
      /移動B\n\n\*\*移動A\*\*!\[paste-e2e\]\(\/_emdash\/api\/media\/file\/[^)]+\)/,
    )
    expect(added).toMatch(/\| A +\| B +\|/)
    await shot(page, "02b-editor-edited")
  })

  test("4. 新規記事: 下書き → 予約 → 予約取り消し → 公開 → 公開取り消し → 削除", async () => {
    await page.goto(ADMIN)
    await page.getByRole("link", { name: "新しい記事" }).click()
    await expect(page.locator(".ad-title")).toBeFocused({ timeout: 30_000 })
    await page.locator(".ad-title").fill("新規記事のテスト")
    // 日本語のタイトルからは英数字の slug を作れないので必須チェックが出る
    await expect(page.locator("#prop-slug-hint")).toContainText(
      "日付の後ろに英数字",
    )
    await expect(saveStatus(page)).toHaveText("slug を決めると保存されます", {
      timeout: 10_000,
    })
    const slug = `${await page.locator("#prop-slug").inputValue()}e2e_new_post`
    await page.locator("#prop-slug").fill(slug)
    await body(page).click()
    await page.keyboard.type("新しい記事の本文です。")
    await expect(page).toHaveURL(/\/_emdash\/admin\/posts\/[0-9A-Z]{26}$/, {
      timeout: 30_000,
    })
    await expectSaved(page)
    const id = page.url().split("/").pop() as string
    // 作成後は slug を変えられない
    await expect(page.locator("#prop-slug")).toHaveCount(0)
    const created = await getPost(page.request, id)
    expect(created.item.slug).toBe(slug)
    expect(created.item.status).toBe("draft")
    expect(created.item.data.markdown).toBe("新しい記事の本文です。\n")

    // 予約
    await page.getByRole("button", { name: /^公開/ }).click()
    await shot(page, "06-publish-menu")
    await page.getByRole("menuitem", { name: /日時を指定して公開/ }).click()
    await expect(page.getByLabel("予約日時")).toBeVisible()
    await shot(page, "07-schedule-picker")
    await page.getByRole("button", { name: "予約する" }).click()
    await expect(page.locator(".ad-props .ad-state")).toHaveText("予約", {
      timeout: 15_000,
    })
    expect((await getPost(page.request, id)).item.status).toBe("scheduled")

    // 予約を取り消す
    await page.getByRole("button", { name: /予約済み/ }).click()
    await page.getByRole("menuitem", { name: /予約を取り消す/ }).click()
    await expect(page.locator(".ad-props .ad-state")).toHaveText("下書き", {
      timeout: 15_000,
    })
    expect((await getPost(page.request, id)).item.status).toBe("draft")

    // 公開
    await page.getByRole("button", { name: /^公開/ }).click()
    await page.getByRole("menuitem", { name: /今すぐ公開/ }).click()
    await expect(page.locator(".ad-props .ad-state")).toHaveText("公開中", {
      timeout: 15_000,
    })
    const live = await publicHtml(page.request, `/articles/${slug}`)
    expect(live.status).toBe(200)
    expect(live.text).toContain("新しい記事の本文です。")

    // 公開を取り消す
    await page.getByRole("button", { name: /公開中/ }).click()
    await page.getByRole("menuitem", { name: /公開を取り消す/ }).click()
    await page.getByRole("button", { name: "取り消す", exact: true }).click()
    await expect(page.locator(".ad-props .ad-state")).toHaveText("下書き", {
      timeout: 15_000,
    })
    expect((await publicHtml(page.request, `/articles/${slug}`)).status).toBe(
      404,
    )

    // 削除
    await page.getByRole("button", { name: "その他の操作" }).click()
    await page.getByRole("menuitem", { name: "削除" }).click()
    await page.getByRole("button", { name: "削除する" }).click()
    await expect(page).toHaveURL(new RegExp(`${ADMIN}$`))
    const response = await page.request.get(`${API}/content/posts/${id}`, {
      headers: { "X-EmDash-Request": "1" },
    })
    expect(response.status()).toBe(404)
  })

  test("5. 公開済みの記事を編集 → 公開中＋未公開の変更 → 変更を公開", async () => {
    const post = await findPost(page.request, "20231110_cloudflare_domain")
    await openEditor(page, post.id)
    await hoverBlock(page, body(page).locator(":scope > *").last())
    await page.getByRole("button", { name: "下にブロックを追加" }).click()
    await page.keyboard.press("Backspace")
    await page.keyboard.type("E2E 公開後の変更")
    await expectSaved(page)
    await expect(page.locator(".ad-props .ad-state")).toHaveText(
      "公開中＋未公開の変更",
    )
    expect(
      (await publicHtml(page.request, `/articles/${post.slug}`)).text,
    ).not.toContain("E2E 公開後の変更")
    // 一覧にも出る
    await page.getByRole("link", { name: "記事", exact: true }).first().click()
    await expect(
      page
        .locator(".ad-table tbody tr")
        .filter({
          has: page.getByRole("link", { name: post.data.title, exact: true }),
        })
        .locator(".ad-state"),
    ).toHaveText("公開中＋未公開の変更")
    await openEditor(page, post.id)
    await page.getByRole("button", { name: /変更を公開/ }).click()
    await page.getByRole("menuitem", { name: "変更を公開" }).click()
    await expect(page.locator(".ad-props .ad-state")).toHaveText("公開中", {
      timeout: 15_000,
    })
    expect(
      (await publicHtml(page.request, `/articles/${post.slug}`)).text,
    ).toContain("E2E 公開後の変更")
  })

  test("6. 衝突: 別の場所で _rev が進んでいたら知らせる", async () => {
    const post = await findPost(page.request, "20231117_cloudflare_workers")
    await openEditor(page, post.id)
    // 別タブ相当: API で直接保存して _rev を進める
    const current = await getPost(page.request, post.id)
    await api(page.request, `/content/posts/${post.id}`, {
      method: "PUT",
      data: { data: { description: "別の場所での変更" }, _rev: current._rev },
    })
    await page.locator(".ad-title").click()
    await page.keyboard.press("End")
    await page.keyboard.type(" 衝突")
    await expect(
      page.getByRole("dialog", { name: "別の場所で変更されました" }),
    ).toBeVisible({ timeout: 20_000 })
    await expect(saveStatus(page)).toHaveText("別の場所で変更されました")
    await shot(page, "08-conflict")
    await page.getByRole("button", { name: "上書きする" }).click()
    await expectSaved(page)
    const after = (await getPost(page.request, post.id)).item.data
    expect(after.title).toBe(`${post.data.title} 衝突`)
    // 上書きなので、この画面の値 (元の説明) で書き戻る
    expect(after.description).toBe(post.data.description)
  })

  test("7. メディア: 複数アップロード・alt・記事への挿入・カバー・削除", async () => {
    await page.goto(`${ADMIN}/media`)
    await page.getByTestId("media-file-input").setInputFiles([
      { name: "e2e-one.png", mimeType: "image/png", buffer: pngVariant(11) },
      { name: "e2e-two.png", mimeType: "image/png", buffer: pngVariant(12) },
    ])
    await expect(page.getByRole("button", { name: "e2e-one.png" })).toBeVisible(
      {
        timeout: 30_000,
      },
    )
    await expect(
      page.getByRole("button", { name: "e2e-two.png" }),
    ).toBeVisible()
    await shot(page, "09-media-list")

    // alt の編集
    await page.getByRole("button", { name: "e2e-one.png" }).click()
    const detail = page.getByRole("complementary", { name: "メディアの詳細" })
    await detail.getByRole("textbox").fill("E2E の代替テキスト")
    await detail.getByRole("button", { name: "alt を保存" }).click()
    await expect(
      page.locator(".ad-toast", { hasText: "代替テキストを保存しました" }),
    ).toBeVisible()
    await shot(page, "10-media-detail")
    const { items } = await api<{
      items: { id: string; filename: string; alt: string | null; url: string }[]
    }>(page.request, "/media?q=e2e-one")
    const one = items.find((item) => item.filename === "e2e-one.png")
    expect(one?.alt).toBe("E2E の代替テキスト")

    // 記事に挿入・カバーに設定
    const post = await findPost(page.request, "20240101_akeome")
    await openEditor(page, post.id)
    await hoverBlock(page, body(page).locator(":scope > *").last())
    await page.getByRole("button", { name: "下にブロックを追加" }).click()
    await page.keyboard.type("gazou")
    await page.keyboard.press("Enter")
    const picker = page.getByRole("dialog", { name: "画像を挿入" })
    await picker.getByRole("button", { name: "e2e-one.png" }).click()
    await expect(body(page).locator(`img[src='${one?.url}']`)).toBeVisible()
    await page.locator(".ad-title-area").hover()
    await page.getByRole("button", { name: "カバーを追加" }).click()
    await page
      .getByRole("dialog", { name: "カバー画像" })
      .getByRole("button", { name: "e2e-one.png" })
      .click()
    await expect(page.getByTestId("cover").locator("img")).toHaveAttribute(
      "src",
      one?.url ?? "",
    )
    await expectSaved(page)
    const saved = (await getPost(page.request, post.id)).item.data
    expect(saved.thumbnail).toBe(one?.url)
    expect(saved.markdown).toContain(`![E2E の代替テキスト](${one?.url})`)

    // 削除 (使われているものは警告、使われていないものを消す)
    await page.goto(`${ADMIN}/media`)
    await page.getByRole("button", { name: "e2e-one.png" }).click()
    await page
      .getByRole("complementary", { name: "メディアの詳細" })
      .getByRole("button", { name: "削除" })
      .click()
    await expect(
      page.getByRole("dialog", { name: "メディアを削除" }),
    ).toContainText("1 件の記事で使われています")
    await page.getByRole("button", { name: "キャンセル" }).click()
    await page.getByRole("button", { name: "e2e-two.png" }).click()
    await page
      .getByRole("complementary", { name: "メディアの詳細" })
      .getByRole("button", { name: "削除" })
      .click()
    await expect(
      page.getByRole("dialog", { name: "メディアを削除" }),
    ).not.toContainText("使われています")
    await page.getByRole("button", { name: "削除する" }).click()
    await expect(page.getByRole("button", { name: "e2e-two.png" })).toHaveCount(
      0,
    )
    const left = await api<{ items: { filename: string }[] }>(
      page.request,
      "/media?q=e2e-two",
    )
    expect(
      left.items.filter((item) => item.filename === "e2e-two.png"),
    ).toEqual([])
  })

  test("8. タグ: 改名・統合・削除 (影響一覧を確認してから実行)", async () => {
    // 改名する記事のうち 1 件に未公開の変更を作っておく
    const r2ja = await findPost(
      page.request,
      "20260710_1_cloudflare_r2_macos_finder",
    )
    const r2en = await findPost(
      page.request,
      "20260710_1_cloudflare_r2_macos_finder",
      "en",
    )
    const r2jaCurrent = await getPost(page.request, r2ja.id)
    await api(page.request, `/content/posts/${r2ja.id}`, {
      method: "PUT",
      data: {
        data: { description: "未公開の変更 (E2E)" },
        _rev: r2jaCurrent._rev,
      },
    })

    await page.goto(`${ADMIN}/tags`)
    await expect(
      page.getByRole("heading", { name: "タグ", level: 1 }),
    ).toBeVisible()
    await shot(page, "11-tags")

    // 改名: Rclone → rclone
    await page.getByRole("button", { name: "「Rclone」の名前を変更" }).click()
    await page.getByRole("textbox", { name: "新しい名前" }).fill("rclone")
    await page.getByRole("button", { name: "影響する記事を確認" }).click()
    const items = page.getByTestId("plan-item")
    await expect(items).toHaveCount(2)
    await expect(page.getByRole("dialog")).toContainText("更新して公開し直す")
    await expect(page.getByRole("dialog")).toContainText("下書きだけ更新")
    await shot(page, "12-tags-rename-confirm")
    await page.getByRole("button", { name: "2 件の記事を変更する" }).click()
    await expect(page.locator("[data-result=done]")).toHaveCount(2, {
      timeout: 30_000,
    })
    await page.getByRole("button", { name: "閉じる" }).last().click()

    const jaAfter = (await getPost(page.request, r2ja.id)).item
    const enAfter = (await getPost(page.request, r2en.id)).item
    expect(enAfter.data.tags).toContain("rclone")
    expect(enAfter.data.tags).not.toContain("Rclone")
    // 公開し直したので未公開の変更は無い。公開ページにも出る
    expect(enAfter.draftRevisionId).toBeNull()
    expect(
      (await publicHtml(page.request, `/en/articles/${r2en.slug}`)).text,
    ).toContain("rclone")
    // 未公開の変更があった記事は下書きだけ (公開ページは元のタグのまま)
    expect(jaAfter.data.tags).toContain("rclone")
    expect(jaAfter.draftRevisionId).not.toBeNull()
    expect(jaAfter.draftRevisionId).not.toBe(jaAfter.liveRevisionId)
    const jaPublic = (await publicHtml(page.request, `/articles/${r2ja.slug}`))
      .text
    expect(jaPublic).toContain("Rclone")
    expect(jaPublic).not.toContain("未公開の変更 (E2E)")

    // 統合: Workers → Cloudflare Workers
    await page.getByRole("button", { name: "「Workers」を統合" }).click()
    await page
      .getByRole("combobox", { name: "まとめ先のタグ" })
      .fill("Cloudflare Workers")
    await page.getByRole("button", { name: "影響する記事を確認" }).click()
    await expect(items).toHaveCount(2)
    await page.getByRole("button", { name: "2 件の記事を変更する" }).click()
    await expect(page.locator("[data-result=done]")).toHaveCount(2, {
      timeout: 30_000,
    })
    await page.getByRole("button", { name: "閉じる" }).last().click()
    const inbox = await findPost(
      page.request,
      "20260706_cloudflare_agentic_inbox",
    )
    const inboxTags = (await getPost(page.request, inbox.id)).item.data.tags
    expect(inboxTags).toContain("Cloudflare Workers")
    expect(inboxTags).not.toContain("Workers")

    // 削除: OSS
    await page.getByRole("button", { name: "「OSS」を削除" }).click()
    await expect(items).toHaveCount(2)
    await page.getByRole("button", { name: "2 件の記事を変更する" }).click()
    await expect(page.locator("[data-result=done]")).toHaveCount(2, {
      timeout: 30_000,
    })
    await page.getByRole("button", { name: "閉じる" }).last().click()
    for (const locale of ["ja", "en"]) {
      const post = await findPost(
        page.request,
        "20260706_cloudflare_agentic_inbox",
        locale,
      )
      expect(
        (await getPost(page.request, post.id)).item.data.tags,
      ).not.toContain("OSS")
    }
    await expect(
      page.getByRole("button", { name: "「OSS」を削除" }),
    ).toHaveCount(0)
  })

  test("スクリーンショット: ⌘K・ダーク・ギャラリー・幅", async () => {
    await page.goto(ADMIN)
    await expect(page.locator(".ad-table tbody tr").first()).toBeVisible()
    await page.keyboard.press("Control+k")
    await page.getByRole("combobox", { name: "記事を検索" }).fill("cloudflare")
    await shot(page, "13-command-palette")
    await page.keyboard.press("Escape")

    await page.getByRole("button", { name: "ダークにする" }).click()
    await shot(page, "14-list-dark")
    const post = await findPost(
      page.request,
      "20260720_1_cloudflare_containers_github_self_hosted_runners",
    )
    await openEditor(page, post.id)
    await shot(page, "15-editor-dark")
    await page.goto(ADMIN)
    await page.getByRole("button", { name: "ライトにする" }).click()
    await page.getByRole("button", { name: "ギャラリー" }).click()
    await shot(page, "16-gallery")
    await page.getByRole("button", { name: "テーブル" }).click()

    for (const width of [1440, 1024, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 })
      await page.goto(ADMIN)
      await page.waitForTimeout(500)
      await shot(page, `17-list-${width}`)
      await openEditor(page, post.id)
      await shot(page, `18-editor-${width}`)
    }
    await page.setViewportSize({ width: 1440, height: 900 })
  })
})

test("9. 公開ページの HTML が変更前と同じ", async ({ request }) => {
  const before = process.env.COMPARE_BEFORE_URL
  const after = process.env.COMPARE_AFTER_URL
  test.skip(
    !before || !after,
    "COMPARE_BEFORE_URL / COMPARE_AFTER_URL を渡したときだけ",
  )
  const seed = JSON.parse(
    await readFile(new URL("../seed/seed.json", import.meta.url), "utf8"),
  ) as {
    content: { posts: { slug: string; locale: string }[] }
  }
  const paths = [
    "/",
    "/about",
    "/feed",
    "/sitemap.xml",
    "/en",
    "/en/about",
    "/en/feed",
    "/not-found-page",
    ...seed.content.posts.map(
      (post) => `${post.locale === "en" ? "/en" : ""}/articles/${post.slug}`,
    ),
  ]
  // 別ポートで立てるので、URL の origin もそろえる
  const normalize = (html: string) =>
    html
      .replace(/https?:\/\/(?:localhost|127\.0\.0\.1):\d+/g, "ORIGIN")
      .replace(/\/_astro\/[^"' )]+/g, "/_astro/X")
      .replace(/\buid="[^"]*"/g, 'uid="X"')
      .replace(/astro-island uid=\S+/g, "astro-island")
  for (const path of paths) {
    const [a, b] = await Promise.all([
      request.get(`${before}${path}`),
      request.get(`${after}${path}`),
    ])
    expect(b.status(), path).toBe(a.status())
    expect(normalize(await b.text()), path).toBe(normalize(await a.text()))
  }
})
