import typography from "@tailwindcss/typography"
import type { Config } from "tailwindcss"

const config: Config = {
  content: ["./src/**/*.{astro,js,ts,jsx,tsx}"],
  plugins: [typography],
  theme: {
    extend: {
      colors: {
        // セマンティックカラー（CSS変数参照）
        bg: {
          base: "var(--bg-base)",
          surface: "var(--bg-surface)",
          "surface-hover": "var(--bg-surface-hover)",
          elevated: "var(--bg-elevated)",
          muted: "var(--bg-muted)",
        },
        text: {
          primary: "var(--text-primary)",
          secondary: "var(--text-secondary)",
          muted: "var(--text-muted)",
          inverse: "var(--text-inverse)",
          link: "var(--text-link)",
          "link-hover": "var(--text-link-hover)",
        },
        brand: {
          primary: "var(--brand-primary)",
          "primary-dark": "var(--brand-primary-dark)",
          "primary-light": "var(--brand-primary-light)",
        },
        accent: {
          blue: "var(--accent-blue)",
          yellow: "var(--accent-yellow)",
          pink: "var(--accent-pink)",
          red: "var(--accent-red)",
          // 後方互換用
          default: "var(--accent-red)",
        },
        border: {
          DEFAULT: "var(--border-default)",
          subtle: "var(--border-subtle)",
          brand: "var(--border-brand)",
        },
        // 後方互換用エイリアス
        primary: {
          default: "var(--brand-primary)",
          dark: "var(--brand-primary-dark)",
          light: "var(--brand-primary-light)",
          bg: "var(--bg-base)",
        },
      },
      fontFamily: {
        sans: ["Inter", "Noto Sans JP", "system-ui", "sans-serif"],
        system: ["system-ui"],
      },
      spacing: {
        "page-x": "1rem",
        "page-bottom": "5rem",
        card: "1.5rem",
        "card-sm": "0.5rem",
        "section-gap": "1rem",
        "section-bottom": "2.5rem",
        "heading-bottom": "0.5rem",
        "btn-x": "1rem",
        "btn-y": "0.5rem",
        "inline-x": "0.25rem",
        "inline-y": "0.125rem",
        "icon-gap": "0.25rem",
      },
      boxShadow: {
        "glow-white": "0 0 20px rgba(255, 255, 255, 0.3)",
        "glow-primary": "0 0 20px rgba(81, 79, 201, 0.4)",
        "glow-accent": "0 0 20px rgba(134, 200, 243, 0.4)",
        soft: "0 4px 20px -2px rgba(0, 0, 0, 0.05)",
        hover:
          "0 10px 25px -5px rgba(81, 79, 201, 0.15), 0 8px 10px -6px rgba(0, 0, 0, 0.1)",
      },
    },
  },
}
export default config
