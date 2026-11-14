import { useMemo, useState } from "react"
import {
  PiArrowRightBold,
  PiArrowsMergeBold,
  PiCheckBold,
  PiPencilSimpleBold,
  PiTrashBold,
  PiWarningBold,
} from "react-icons/pi"
import { api } from "../api/client"
import { Dialog, StateBadge, TagChip } from "../components/ui"
import { LOCALE_LABELS } from "../lib/format"
import {
  ACTION_LABELS,
  aggregateTags,
  executeTagPlan,
  type ItemResult,
  type PlanItem,
  planTagChange,
  type TagOperation,
  type TagPost,
  validateOperation,
} from "../lib/tags"
import { Link, useDocumentTitle } from "../router"
import { useAdmin } from "../store"

type Draft =
  | { kind: "rename"; from: string; to: string }
  | { kind: "merge"; from: string; into: string }
  | { kind: "delete"; tag: string }

function toOperation(draft: Draft): TagOperation {
  if (draft.kind === "merge") {
    return { kind: "merge", from: [draft.from], into: draft.into.trim() }
  }
  if (draft.kind === "rename") {
    return { kind: "rename", from: draft.from, to: draft.to.trim() }
  }
  return draft
}

const TITLES = {
  rename: "タグの名前を変更",
  merge: "タグを統合",
  delete: "タグを削除",
}

export function TagsPage() {
  useDocumentTitle("タグ")
  const { rows, layout, access, reload } = useAdmin()
  const [draft, setDraft] = useState<Draft | null>(null)
  const [query, setQuery] = useState("")

  const posts: TagPost[] = useMemo(
    () =>
      rows.map((row) => ({
        id: row.item.id,
        title: row.title,
        locale: row.item.locale ?? "",
        state: row.state,
        tags: row.tags,
        date: row.date,
      })),
    [rows],
  )
  const summary = useMemo(() => aggregateTags(posts), [posts])
  const visible = summary.filter((tag) =>
    tag.name.toLowerCase().includes(query.trim().toLowerCase()),
  )

  if (!layout.tagsField) {
    return (
      <div className="bwa-page">
        <h1 className="bwa-page__title">タグ</h1>
        <p className="mt-4 text-muted">
          このコレクションにはタグの項目がありません。
        </p>
      </div>
    )
  }

  return (
    <div className="bwa-page">
      <h1 className="bwa-page__title">タグ</h1>
      <p className="mb-6 text-muted">
        記事に付いているタグの一覧です ({summary.length}{" "}
        個)。名前の変更・統合・削除は、影響する記事を確認してから実行します。
      </p>
      {!access.canEditAny ? (
        <div className="bwa-callout mb-4" data-tone="warning">
          <PiWarningBold />
          <p>
            他の人の記事のタグは変更できません
            (編集者以上のロールが必要)。自分の記事だけが変わります。
          </p>
        </div>
      ) : null}
      <input
        className="bwa-input mb-3 !w-64"
        type="search"
        placeholder="タグを検索"
        aria-label="タグを検索"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <div className="overflow-x-auto">
        <table className="bwa-table min-w-[640px]">
          <thead>
            <tr>
              <th>タグ</th>
              <th style={{ width: 80 }}>記事数</th>
              <th style={{ width: 160 }}>言語</th>
              <th style={{ width: 120 }}>最終使用日</th>
              <th style={{ width: 230 }} />
            </tr>
          </thead>
          <tbody>
            {visible.map((tag) => (
              <tr key={tag.name} className="!cursor-default">
                <td>
                  <TagChip name={tag.name} />
                </td>
                <td>{tag.count}</td>
                <td className="text-muted">
                  {Object.entries(tag.byLocale)
                    .map(
                      ([locale, count]) =>
                        `${LOCALE_LABELS[locale] ?? locale} ${count}`,
                    )
                    .join(" · ")}
                </td>
                <td className="text-muted">{tag.lastUsed}</td>
                <td>
                  <div className="flex gap-0.5">
                    <button
                      className="bwa-btn bwa-btn--sm"
                      aria-label={`「${tag.name}」の名前を変更`}
                      onClick={() =>
                        setDraft({
                          kind: "rename",
                          from: tag.name,
                          to: tag.name,
                        })
                      }
                    >
                      <PiPencilSimpleBold />
                      名前を変更
                    </button>
                    <button
                      className="bwa-btn bwa-btn--sm"
                      aria-label={`「${tag.name}」を統合`}
                      onClick={() =>
                        setDraft({ kind: "merge", from: tag.name, into: "" })
                      }
                    >
                      <PiArrowsMergeBold />
                      統合
                    </button>
                    <button
                      className="bwa-btn bwa-btn--sm bwa-btn--danger"
                      aria-label={`「${tag.name}」を削除`}
                      onClick={() =>
                        setDraft({ kind: "delete", tag: tag.name })
                      }
                    >
                      <PiTrashBold />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {visible.length === 0 ? (
          <p className="py-10 text-center text-muted">タグはありません</p>
        ) : null}
      </div>
      {draft ? (
        <TagChangeDialog
          draft={draft}
          posts={posts}
          tags={summary.map((tag) => tag.name)}
          field={layout.tagsField}
          onDraft={setDraft}
          onClose={(changed) => {
            setDraft(null)
            if (changed) void reload()
          }}
        />
      ) : null}
    </div>
  )
}

function TagChangeDialog({
  draft,
  posts,
  tags,
  field,
  onDraft,
  onClose,
}: {
  draft: Draft
  posts: TagPost[]
  tags: string[]
  field: string
  onDraft: (draft: Draft) => void
  onClose: (changed: boolean) => void
}) {
  const [step, setStep] = useState<"input" | "confirm" | "running" | "done">(
    draft.kind === "delete" ? "confirm" : "input",
  )
  const [results, setResults] = useState<Map<string, ItemResult>>(new Map())
  const [ran, setRan] = useState(false)
  const operation = toOperation(draft)
  const problem = validateOperation(operation, tags)
  const plan = useMemo(
    () => planTagChange(posts, operation),
    [posts, operation],
  )
  const failed = plan.filter(
    (item) => results.get(item.id)?.status === "failed",
  )

  const run = async (items: PlanItem[]) => {
    setStep("running")
    setRan(true)
    await executeTagPlan(api, items, operation, field, (id, result) =>
      setResults((current) => new Map(current).set(id, result)),
    )
    setStep("done")
  }

  const describe = () => {
    if (operation.kind === "rename") {
      return (
        <span className="flex flex-wrap items-center gap-1">
          <TagChip name={operation.from} /> <PiArrowRightBold />{" "}
          <TagChip name={operation.to || "?"} />
        </span>
      )
    }
    if (operation.kind === "merge") {
      return (
        <span className="flex flex-wrap items-center gap-1">
          <TagChip name={operation.from[0]} /> を{" "}
          <TagChip name={operation.into || "?"} /> にまとめる
        </span>
      )
    }
    return (
      <span className="flex flex-wrap items-center gap-1">
        <TagChip name={operation.tag} /> を全記事から外す
      </span>
    )
  }

  const footer =
    step === "input" ? (
      <>
        <button
          className="bwa-btn bwa-btn--outline"
          onClick={() => onClose(false)}
        >
          キャンセル
        </button>
        <button
          className="bwa-btn bwa-btn--primary"
          disabled={Boolean(problem)}
          onClick={() => setStep("confirm")}
        >
          影響する記事を確認
        </button>
      </>
    ) : step === "confirm" ? (
      <>
        <button
          className="bwa-btn bwa-btn--outline"
          onClick={() =>
            draft.kind === "delete" ? onClose(false) : setStep("input")
          }
        >
          {draft.kind === "delete" ? "キャンセル" : "戻る"}
        </button>
        <button
          className={`bwa-btn ${draft.kind === "delete" ? "bwa-btn--danger-solid" : "bwa-btn--primary"}`}
          disabled={plan.length === 0 || Boolean(problem)}
          onClick={() => void run(plan)}
        >
          {plan.length} 件の記事を変更する
        </button>
      </>
    ) : step === "done" ? (
      <>
        {failed.length > 0 ? (
          <button
            className="bwa-btn bwa-btn--outline"
            onClick={() => void run(failed)}
          >
            失敗した {failed.length} 件を再実行
          </button>
        ) : null}
        <button
          className="bwa-btn bwa-btn--primary"
          onClick={() => onClose(ran)}
        >
          閉じる
        </button>
      </>
    ) : null

  return (
    <Dialog
      title={TITLES[draft.kind]}
      onClose={() => step !== "running" && onClose(ran)}
      footer={footer}
      wide
    >
      {step === "input" ? (
        <div className="grid gap-3">
          {draft.kind === "rename" ? (
            <label className="grid gap-1">
              <span className="text-[13px] text-muted">新しい名前</span>
              <input
                className="bwa-input"
                value={draft.to}
                aria-label="新しい名前"
                onChange={(event) =>
                  onDraft({ ...draft, to: event.target.value })
                }
                onKeyDown={(event) => {
                  if (
                    event.key === "Enter" &&
                    !event.nativeEvent.isComposing &&
                    !problem
                  )
                    setStep("confirm")
                }}
              />
            </label>
          ) : null}
          {draft.kind === "merge" ? (
            <label className="grid gap-1">
              <span className="text-[13px] text-muted">
                まとめ先のタグ (既存のタグから選ぶか、新しい名前)
              </span>
              <input
                className="bwa-input"
                list="merge-targets"
                value={draft.into}
                aria-label="まとめ先のタグ"
                onChange={(event) =>
                  onDraft({ ...draft, into: event.target.value })
                }
              />
              <datalist id="merge-targets">
                {tags
                  .filter((tag) => tag !== draft.from)
                  .map((tag) => (
                    <option key={tag} value={tag} />
                  ))}
              </datalist>
            </label>
          ) : null}
          <div className="text-[13px]">{describe()}</div>
          {problem ? (
            <p className="text-[13px] text-danger">{problem}</p>
          ) : null}
          {draft.kind === "rename" &&
          tags.includes(operation.kind === "rename" ? operation.to : "") ? (
            <p className="text-[13px] text-warning">
              同じ名前のタグがすでにあるので、統合と同じ結果になります。
            </p>
          ) : null}
        </div>
      ) : (
        <div className="grid gap-3">
          <div className="text-[14px]">{describe()}</div>
          <div className="bwa-callout text-[13px]">
            <PiWarningBold />
            <div>
              <p>
                公開中の記事は、他に未公開の変更が無ければタグを変えて公開し直します。
              </p>
              <p>
                未公開の変更がある記事は下書きだけを変えます
                (他の変更を勝手に公開しないため)。下書き・予約の記事は下書きを変えます。
              </p>
            </div>
          </div>
          {plan.length === 0 ? (
            <p className="text-muted">変更される記事はありません。</p>
          ) : null}
          <ul
            className="grid max-h-[46vh] gap-1 overflow-auto"
            aria-label="影響する記事"
          >
            {plan.map((item) => {
              const result = results.get(item.id)
              return (
                <li
                  key={item.id}
                  className="grid gap-1 rounded-md p-2 shadow-[0_0_0_1px_var(--admin-line)]"
                  data-testid="plan-item"
                >
                  <div className="flex items-center gap-2">
                    <Link
                      to={`/posts/${item.id}`}
                      className="min-w-0 flex-1 truncate font-medium text-fg"
                      target="_blank"
                    >
                      {item.title || "無題"}
                    </Link>
                    {item.locale === "en" ? (
                      <span className="text-[12px] text-muted">EN</span>
                    ) : null}
                    <StateBadge state={item.state} />
                  </div>
                  <div className="flex flex-wrap items-center gap-1 text-[12.5px]">
                    {item.before.map((tag) => (
                      <TagChip key={`b-${tag}`} name={tag} />
                    ))}
                    <PiArrowRightBold className="text-muted" />
                    {item.after.length === 0 ? (
                      <span className="text-muted">(なし)</span>
                    ) : null}
                    {item.after.map((tag) => (
                      <TagChip key={`a-${tag}`} name={tag} />
                    ))}
                  </div>
                  <div className="flex items-center gap-1 text-[12.5px] text-muted">
                    {ACTION_LABELS[item.action]}
                    {result ? <ResultLabel result={result} /> : null}
                  </div>
                </li>
              )
            })}
          </ul>
          {step === "done" ? (
            <p role="status" className="text-[13px]">
              完了:{" "}
              {
                plan.filter((item) => results.get(item.id)?.status === "done")
                  .length
              }{" "}
              件
              {failed.length > 0
                ? ` · 失敗: ${failed.length} 件 (どこまで済んだかは各記事の表示を見てください)`
                : ""}
            </p>
          ) : null}
        </div>
      )}
    </Dialog>
  )
}

function ResultLabel({ result }: { result: ItemResult }) {
  switch (result.status) {
    case "running":
      return <span className="ml-auto">実行中…</span>
    case "done":
      return (
        <span
          className="ml-auto flex items-center gap-1 text-success"
          data-result="done"
        >
          <PiCheckBold />
          {result.published ? "更新して公開しました" : "下書きを更新しました"}
        </span>
      )
    case "skipped":
      return <span className="ml-auto">スキップ ({result.reason})</span>
    case "failed":
      return (
        <span className="ml-auto text-danger" data-result="failed">
          失敗: {result.message}
          {result.updated ? " (下書きは更新済み・公開は未実行)" : ""}
        </span>
      )
    default:
      return null
  }
}
