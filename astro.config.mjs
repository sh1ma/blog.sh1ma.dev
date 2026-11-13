import cloudflare from "@astrojs/cloudflare"
import react from "@astrojs/react"
import { d1, r2 } from "@emdash-cms/cloudflare"
import tailwindcss from "@tailwindcss/vite"
import { defineConfig } from "astro/config"
import emdash from "emdash/astro"
import { markdownEditorPlugin } from "./src/plugins/markdown-editor"

export default defineConfig({
  site: process.env.SITE_URL ?? "https://blog.sh1ma.dev",
  output: "server",
  trailingSlash: "ignore",
  adapter: cloudflare(),
  devToolbar: { enabled: false },
  vite: { plugins: [tailwindcss()] },
  i18n: {
    defaultLocale: "ja",
    locales: ["ja", "en"],
  },
  integrations: [
    react(),
    emdash({
      database: d1({ binding: "DB" }),
      storage: r2({ binding: "MEDIA" }),
      plugins: [markdownEditorPlugin()],
    }),
  ],
})
