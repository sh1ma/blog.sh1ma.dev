// 管理画面のクラス名・ID が広告ブロッカー（EasyList などの汎用の非表示ルール）に
// 当たらないことを確かめる。以前は `ad-` 接頭辞のクラス（`.ad-main` など）が
// uBlock Origin に隠され、ログイン後の画面が真っ黒になった。
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const ROOT = join(import.meta.dirname, "..", "..")
const SOURCE = /\.(tsx?|css|astro)$/

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return files(path)
    return SOURCE.test(name) && !name.endsWith(".test.ts") ? [path] : []
  })
}

// 汎用ルールでよく狙われる名前。先頭一致・単語単位で見る
const BLOCKED = [
  /^ads?(-|_|$)/,
  /^ad[A-Z]/,
  /(^|-)ads?(-|$)/,
  /advert/i,
  /sponsor/i,
  /banner/i,
  /promo/i,
]

function namesIn(source: string): string[] {
  const names = new Set<string>()
  for (const m of source.matchAll(
    /className=(?:"([^"]*)"|\{`([^`]*)`\}|\{"([^"]*)"\})/g,
  )) {
    for (const token of (m[1] ?? m[2] ?? m[3] ?? "").split(/\s+/)) {
      if (/^[A-Za-z][\w-]*$/.test(token)) names.add(token)
    }
  }
  for (const m of source.matchAll(/[.#]([A-Za-z][\w-]*)\s*[{,:[.>~+ ]/g))
    names.add(m[1])
  for (const m of source.matchAll(/\bid="([^"]+)"/g)) names.add(m[1])
  return [...names]
}

describe("管理画面のクラス名", () => {
  const sources = files(ROOT)

  it("ソースが見つかる", () => {
    expect(sources.length).toBeGreaterThan(0)
  })

  it("広告ブロッカーの汎用ルールに当たる名前を使わない", () => {
    const hits = sources.flatMap((path) =>
      namesIn(readFileSync(path, "utf8"))
        .filter((name) => BLOCKED.some((re) => re.test(name)))
        .map((name) => `${path.slice(ROOT.length + 1)}: ${name}`),
    )
    expect(hits).toEqual([])
  })
})
