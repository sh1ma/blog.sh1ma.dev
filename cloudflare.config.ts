import { bindings, defineConfig, triggers } from "cf/config"

export default defineConfig({
  worker: {
    name: "blog",
    compatibilityDate: "2026-10-30",
    compatibilityFlags: ["nodejs_compat"],
    workersDev: true,
    previewUrls: true,
    observability: { enabled: true, traces: { enabled: true } },
    domains: ["blog.sh1ma.dev"],
    env: {
      DB: bindings.d1({
        name: "blog-emdash",
        id: "416f10ff-1fde-44eb-ab0d-121f3a5612a9",
      }),
      MEDIA: bindings.r2({ name: "blog-emdash-media" }),
      SESSION: bindings.kv({ id: "6af0e9957952470b949e44940ec635c0" }),
      IMAGES: bindings.images(),
      ASSETS: bindings.assets(),
      EMDASH_SITE_URL: bindings.text("https://blog.sh1ma.dev"),
    },
    triggers: [triggers.scheduled({ schedule: "* * * * *" })],
  },
})
