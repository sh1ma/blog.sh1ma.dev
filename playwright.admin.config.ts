import { defineConfig, devices } from "@playwright/test"

// 管理画面の Markdown エディタ (src/plugins/markdown-editor) を手元で確かめる設定。
// CI の E2E (playwright.config.ts) には含めない。dev-bypass でログインするため
// `astro dev` で立てた EmDash が必要。手順は e2e/markdown-editor.admin.ts の先頭を参照。
const port = process.env.ADMIN_EDITOR_PORT ?? "8799"

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.admin.ts",
  timeout: 180 * 1000,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
})
