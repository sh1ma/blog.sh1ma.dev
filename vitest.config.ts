import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    // e2e/ は Playwright のテストなので含めない
    include: ["src/**/*.test.ts", "lib/**/*.test.ts"],
    testTimeout: 120_000,
  },
})
