// 端末 (localStorage) に退避した書きかけ。サーバーに保存できなかったとき・
// 保存前にタブを閉じたときに残り、次に開いたときに復元を提案する。

const PREFIX = "blog-admin:stash:"

export type StashEntry = {
  /** 記事 ID。新規でまだサーバーに無いものは "new:<ランダム>" */
  key: string
  savedAt: number
  /** 退避したときにサーバーで読んでいた版 (_rev) */
  baseRev: string | undefined
  data: Record<string, unknown>
  slug?: string | null
  locale?: string
  translationOf?: string
}

type Storage = Pick<
  globalThis.Storage,
  "getItem" | "setItem" | "removeItem" | "key" | "length"
>

function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null
  }
}

export function writeStash(entry: StashEntry, store = storage()) {
  try {
    store?.setItem(PREFIX + entry.key, JSON.stringify(entry))
  } catch {
    // 容量超過など。退避できなくても編集は続けられる
  }
}

export function readStash(key: string, store = storage()): StashEntry | null {
  try {
    const raw = store?.getItem(PREFIX + key)
    if (!raw) return null
    const entry = JSON.parse(raw) as StashEntry
    return entry && typeof entry.data === "object" ? entry : null
  } catch {
    return null
  }
}

export function clearStash(key: string, store = storage()) {
  try {
    store?.removeItem(PREFIX + key)
  } catch {
    // 何もしない
  }
}

export function listStashes(store = storage()): StashEntry[] {
  if (!store) return []
  const entries: StashEntry[] = []
  for (let index = 0; index < store.length; index++) {
    const name = store.key(index)
    if (!name?.startsWith(PREFIX)) continue
    const entry = readStash(name.slice(PREFIX.length), store)
    if (entry) entries.push(entry)
  }
  return entries.sort((a, b) => b.savedAt - a.savedAt)
}

/** 退避した値がサーバーの値と違うか (同じなら復元を提案しない) */
export function stashDiffers(
  entry: StashEntry,
  data: Record<string, unknown>,
): boolean {
  return Object.entries(entry.data).some(
    ([key, value]) => JSON.stringify(value) !== JSON.stringify(data[key]),
  )
}
