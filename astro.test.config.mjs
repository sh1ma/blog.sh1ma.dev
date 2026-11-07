import node from "@astrojs/node"
import react from "@astrojs/react"
import tailwindcss from "@tailwindcss/vite"
import { defineConfig } from "astro/config"
import emdash, { local } from "emdash/astro"
import { sqlite } from "emdash/db"

export default defineConfig({
  site: "http://127.0.0.1:8787",
  output: "server",
  trailingSlash: "ignore",
  adapter: node({ mode: "standalone" }),
  devToolbar: { enabled: false },
  vite: { plugins: [tailwindcss()] },
  i18n: {
    defaultLocale: "ja",
    locales: ["ja", "en"],
  },
  integrations: [
    react(),
    emdash({
      database: sqlite({ url: "file:./data.db" }),
      storage: local({
        directory: "./uploads",
        baseUrl: "/_emdash/api/media/file",
      }),
    }),
  ],
})
