import type { Api } from "../api/client"
import type { ContentItem } from "../api/types"
import { type PostState, postState } from "./status"

// タグの集計と一括変更 (改名・統合・削除)。
// tags は選択肢を持たない multiSelect なので、タグの一覧は記事から集計する。
//
// 公開済み記事の扱い:
// - 公開中で他に未公開の変更が無い → タグを変えて公開し直す (update → publish)
// - 公開中で未公開の変更がある → 下書きだけ変える (勝手に他の変更まで公開しない)
// - 下書き・予約 → 下書きを変える (予約はそのまま。予約時刻に変更後の下書きが公開される)

export type TagPost = {
  id: string
  title: string
  locale: string
  state: PostState
  tags: string[]
  /** 公開日 (YYYY-MM-DD)。無ければ空文字 */
  date: string
}

export type TagSummary = {
  name: string
  count: number
  byLocale: Record<string, number>
  /** 使っている記事の公開日のうち最新 */
  lastUsed: string
  postIds: string[]
}

export function tagsOf(data: Record<string, unknown>, field: string): string[] {
  const value = data[field]
  return Array.isArray(value)
    ? value.filter((tag): tag is string => typeof tag === "string")
    : []
}

export function aggregateTags(posts: TagPost[]): TagSummary[] {
  const map = new Map<string, TagSummary>()
  for (const post of posts) {
    for (const name of new Set(post.tags)) {
      let summary = map.get(name)
      if (!summary) {
        summary = { name, count: 0, byLocale: {}, lastUsed: "", postIds: [] }
        map.set(name, summary)
      }
      summary.count++
      summary.byLocale[post.locale] = (summary.byLocale[post.locale] ?? 0) + 1
      if (post.date > summary.lastUsed) summary.lastUsed = post.date
      summary.postIds.push(post.id)
    }
  }
  return [...map.values()].sort(
    (a, b) => b.count - a.count || a.name.localeCompare(b.name, "ja"),
  )
}

export type TagOperation =
  | { kind: "rename"; from: string; to: string }
  | { kind: "merge"; from: string[]; into: string }
  | { kind: "delete"; tag: string }

/** タグの並びに操作を当てる。順番は保ち、重複は前のものを残す */
export function applyOperation(tags: string[], op: TagOperation): string[] {
  let next: string[]
  switch (op.kind) {
    case "rename":
      next = tags.map((tag) => (tag === op.from ? op.to.trim() : tag))
      break
    case "merge": {
      const from = new Set(op.from)
      next = tags.map((tag) => (from.has(tag) ? op.into.trim() : tag))
      break
    }
    case "delete":
      next = tags.filter((tag) => tag !== op.tag)
      break
  }
  return [...new Set(next.filter((tag) => tag !== ""))]
}

export type PlanAction =
  /** 下書き (または予約) を書き換える */
  | "update"
  /** 書き換えて公開し直す */
  | "update_and_publish"
  /** 未公開の変更があるので下書きだけ書き換える (公開ページは変わらない) */
  | "update_draft_only"

export type PlanItem = {
  id: string
  title: string
  locale: string
  state: PostState
  before: string[]
  after: string[]
  action: PlanAction
}

export function actionFor(state: PostState): PlanAction {
  if (state === "published") return "update_and_publish"
  if (state === "changed" || state === "changed_scheduled") {
    return "update_draft_only"
  }
  return "update"
}

export const ACTION_LABELS: Record<PlanAction, string> = {
  update: "下書きを更新",
  update_and_publish: "更新して公開し直す",
  update_draft_only: "下書きだけ更新 (未公開の変更があるため公開しない)",
}

export function validateOperation(
  op: TagOperation,
  existing: string[],
): string | null {
  switch (op.kind) {
    case "rename":
      if (!op.to.trim()) return "新しい名前を入力してください"
      if (op.to.trim() === op.from) return "名前が変わっていません"
      return null
    case "merge":
      if (op.from.length === 0) return "まとめるタグを選んでください"
      if (!op.into.trim()) return "まとめ先のタグを選んでください"
      if (op.from.every((tag) => tag === op.into)) {
        return "まとめ先と同じタグしか選ばれていません"
      }
      return null
    case "delete":
      if (!op.tag) return "削除するタグを選んでください"
      return existing.includes(op.tag) ? null : "そのタグは使われていません"
  }
}

/** どの記事をどう変えるか。変わらない記事は含めない */
export function planTagChange(posts: TagPost[], op: TagOperation): PlanItem[] {
  const items: PlanItem[] = []
  for (const post of posts) {
    const after = applyOperation(post.tags, op)
    if (JSON.stringify(after) === JSON.stringify(post.tags)) continue
    items.push({
      id: post.id,
      title: post.title,
      locale: post.locale,
      state: post.state,
      before: post.tags,
      after,
      action: actionFor(post.state),
    })
  }
  return items
}

export type ItemResult =
  | { status: "pending" }
  | { status: "running" }
  | { status: "done"; action: PlanAction; published: boolean }
  | { status: "skipped"; reason: string }
  | { status: "failed"; message: string; updated: boolean }

/**
 * 計画を 1 記事ずつ実行する。実行直前に記事を読み直し、そのときの状態で
 * 公開し直すかを決め直す (計画を見ている間に他で変わっていても他の変更を公開しない)。
 * 途中で失敗しても残りは続け、結果を記事ごとに返す (失敗したものだけ再実行できる)。
 */
export async function executeTagPlan(
  api: Pick<Api, "getPost" | "updatePost" | "publish">,
  plan: PlanItem[],
  op: TagOperation,
  field: string,
  onProgress?: (id: string, result: ItemResult) => void,
): Promise<Map<string, ItemResult>> {
  const results = new Map<string, ItemResult>()
  const report = (id: string, result: ItemResult) => {
    results.set(id, result)
    onProgress?.(id, result)
  }
  for (const item of plan) {
    report(item.id, { status: "running" })
    let updated = false
    try {
      const { item: current, _rev } = await api.getPost(item.id)
      const before = tagsOf(current.data, field)
      const after = applyOperation(before, op)
      if (JSON.stringify(after) === JSON.stringify(before)) {
        // 前回の実行で下書きだけ変わり公開に失敗した場合もここに来る。
        // 他の変更と区別できないので勝手に公開せず、記事の画面での公開を案内する
        report(item.id, {
          status: "skipped",
          reason:
            postState(current) === "changed"
              ? "タグは変更済み。未公開なら記事の画面から「変更を公開」"
              : "すでに変更済み",
        })
        continue
      }
      const action = actionFor(postState(current))
      const saved = await api.updatePost(item.id, {
        data: { [field]: after },
        _rev,
      })
      updated = true
      let published = false
      if (action === "update_and_publish") {
        await api.publish(item.id, { _rev: saved._rev })
        published = true
      }
      report(item.id, { status: "done", action, published })
    } catch (error) {
      report(item.id, {
        status: "failed",
        message: error instanceof Error ? error.message : String(error),
        updated,
      })
    }
  }
  return results
}

/** ContentItem (下書きを重ねた値) から集計用の形にする */
export function toTagPost(
  item: ContentItem,
  fields: { title: string; tags: string; date: string | null },
): TagPost {
  return {
    id: item.id,
    title: String(item.data[fields.title] ?? ""),
    locale: item.locale ?? "",
    state: postState(item),
    tags: tagsOf(item.data, fields.tags),
    date: fields.date ? String(item.data[fields.date] ?? "") : "",
  }
}
