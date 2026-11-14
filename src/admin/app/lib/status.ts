import type { ContentItem } from "../api/types"

// 記事の状態。EmDash の status と revision の指し先から決める。
// - 公開すると draft_revision_id が NULL になり live_revision_id が公開版を指す
//   (emdash/src/database/repositories/content.ts の publish)
// - 公開中の記事を保存すると下書きリビジョンができ、draftRevisionId !== liveRevisionId になる
//   (純正管理画面の getDraftStatus と同じ判定)
// - 公開中の記事を予約すると status は published のまま scheduledAt が付く (変更の予約)

export type PostState =
  | "draft"
  | "scheduled"
  | "published"
  | "changed"
  | "changed_scheduled"

type StateSource = Pick<
  ContentItem,
  "status" | "scheduledAt" | "draftRevisionId" | "liveRevisionId"
>

export function postState(item: StateSource): PostState {
  if (item.status === "scheduled") return "scheduled"
  if (item.status === "published") {
    if (item.scheduledAt) return "changed_scheduled"
    if (item.draftRevisionId && item.draftRevisionId !== item.liveRevisionId) {
      return "changed"
    }
    return "published"
  }
  return "draft"
}

export const STATE_LABELS: Record<PostState, string> = {
  draft: "下書き",
  scheduled: "予約",
  published: "公開中",
  changed: "公開中＋未公開の変更",
  changed_scheduled: "公開中＋変更を予約",
}

/** 公開ページに出ているか */
export function isLive(state: PostState) {
  return (
    state === "published" ||
    state === "changed" ||
    state === "changed_scheduled"
  )
}

/** 一覧の絞り込みで使うまとまり */
export type StateGroup = "draft" | "scheduled" | "published"

export function stateGroup(state: PostState): StateGroup {
  if (state === "draft") return "draft"
  if (state === "scheduled") return "scheduled"
  return "published"
}

/**
 * 一度でも公開されたか。公開を取り消しても publishedAt は残る
 * (unpublish は status と live_revision_id だけ戻す)。
 * 公開済みの記事は URL を変えないため slug を固定する。
 */
export function wasEverPublished(
  item: Pick<ContentItem, "status" | "publishedAt" | "liveRevisionId">,
) {
  return (
    item.status === "published" ||
    item.publishedAt !== null ||
    item.liveRevisionId !== null
  )
}
