// EmDash のロールと、この管理画面で使う権限。
// 値は @emdash-cms/auth の Role / Permissions (dist/types-*.mjs, dist/index.mjs の rbac) と同じ。
// API 側で必ず検査されるので、ここは画面の出し分けにだけ使う。

export const ROLE = {
  SUBSCRIBER: 10,
  CONTRIBUTOR: 20,
  AUTHOR: 30,
  EDITOR: 40,
  ADMIN: 50,
} as const

export type AdminAccess = {
  /** 記事を作れる・自分の下書きを編集できる (content:create / content:edit_own_drafts) */
  canWrite: boolean
  /** 自分の記事を公開・予約できる (content:publish_own) */
  canPublish: boolean
  /** 他人の記事も編集・公開できる (content:edit_any / content:publish_any) */
  canEditAny: boolean
  /** スキーマを読める (schema:read)。読めないときは既定の項目で表示する */
  canReadSchema: boolean
}

export function accessForRole(role: number): AdminAccess {
  return {
    canWrite: role >= ROLE.CONTRIBUTOR,
    canPublish: role >= ROLE.AUTHOR,
    canEditAny: role >= ROLE.EDITOR,
    canReadSchema: role >= ROLE.EDITOR,
  }
}

export const ROLE_LABELS: Record<number, string> = {
  [ROLE.SUBSCRIBER]: "購読者",
  [ROLE.CONTRIBUTOR]: "寄稿者",
  [ROLE.AUTHOR]: "投稿者",
  [ROLE.EDITOR]: "編集者",
  [ROLE.ADMIN]: "管理者",
}
