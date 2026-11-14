import { useCallback, useEffect, useState } from "react"

// ライト / ダーク。既定は OS に従い、切り替えると localStorage に覚える。
// 最初の描画前の決定は AdminPage.astro の head のスクリプト (同じキーを読む)。

export type ThemeChoice = "system" | "light" | "dark"

const KEY = "blog-admin-theme"

function readChoice(): ThemeChoice {
  try {
    const saved = localStorage.getItem(KEY)
    if (saved === "light" || saved === "dark") return saved
  } catch {
    // 使えなければ OS に従う
  }
  return "system"
}

export function useTheme() {
  const [choice, setChoice] = useState<ThemeChoice>(readChoice)
  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia("(prefers-color-scheme: dark)").matches,
  )

  useEffect(() => {
    const query = window.matchMedia("(prefers-color-scheme: dark)")
    const onChange = () => setSystemDark(query.matches)
    query.addEventListener("change", onChange)
    return () => query.removeEventListener("change", onChange)
  }, [])

  const resolved: "light" | "dark" =
    choice === "system" ? (systemDark ? "dark" : "light") : choice

  useEffect(() => {
    document.documentElement.dataset.adminTheme = resolved
  }, [resolved])

  const choose = useCallback((next: ThemeChoice) => {
    setChoice(next)
    try {
      if (next === "system") localStorage.removeItem(KEY)
      else localStorage.setItem(KEY, next)
    } catch {
      // 覚えられなくても切り替えはする
    }
  }, [])

  return { choice, resolved, choose }
}
