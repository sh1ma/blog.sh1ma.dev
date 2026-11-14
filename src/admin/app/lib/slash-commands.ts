// スラッシュコマンド (/ で開くブロックの一覧) の定義と絞り込み。
// 実際の挿入は editor/commands.ts。ここは React / Tiptap に依存しない。

export type SlashCommandId =
  | "paragraph"
  | "heading1"
  | "heading2"
  | "heading3"
  | "bulletList"
  | "orderedList"
  | "taskList"
  | "blockquote"
  | "alertNote"
  | "alertTip"
  | "alertImportant"
  | "alertWarning"
  | "alertCaution"
  | "codeBlock"
  | "table"
  | "horizontalRule"
  | "mathBlock"
  | "image"
  | "linkCard"

export type SlashCommand = {
  id: SlashCommandId
  label: string
  description: string
  group: "基本" | "リスト" | "アラート" | "メディア・その他"
  /** 検索用の別名 (英語・ローマ字・Markdown 記法) */
  keywords: string[]
  /** 変換 (ブロックメニューの「変換」) に使えるか */
  convertible: boolean
}

export const SLASH_COMMANDS: SlashCommand[] = [
  {
    id: "paragraph",
    label: "テキスト",
    description: "ふつうの段落",
    group: "基本",
    keywords: ["text", "paragraph", "p", "tekisuto", "danraku"],
    convertible: true,
  },
  {
    id: "heading1",
    label: "見出し 1",
    description: "大きな見出し (#)",
    group: "基本",
    keywords: ["h1", "heading", "#", "midashi"],
    convertible: true,
  },
  {
    id: "heading2",
    label: "見出し 2",
    description: "中くらいの見出し (##)",
    group: "基本",
    keywords: ["h2", "heading", "##", "midashi"],
    convertible: true,
  },
  {
    id: "heading3",
    label: "見出し 3",
    description: "小さな見出し (###)",
    group: "基本",
    keywords: ["h3", "heading", "###", "midashi"],
    convertible: true,
  },
  {
    id: "bulletList",
    label: "箇条書き",
    description: "- で始まるリスト",
    group: "リスト",
    keywords: ["bullet", "list", "ul", "-", "kajougaki"],
    convertible: true,
  },
  {
    id: "orderedList",
    label: "番号付きリスト",
    description: "1. で始まるリスト",
    group: "リスト",
    keywords: ["number", "ordered", "list", "ol", "1.", "bangou"],
    convertible: true,
  },
  {
    id: "taskList",
    label: "ToDo リスト",
    description: "チェックボックス付き",
    group: "リスト",
    keywords: ["todo", "task", "list", "check", "[]"],
    convertible: true,
  },
  {
    id: "blockquote",
    label: "引用",
    description: "> で始まる引用",
    group: "基本",
    keywords: ["quote", "blockquote", ">", "inyou"],
    convertible: true,
  },
  {
    id: "alertNote",
    label: "アラート: NOTE",
    description: "補足",
    group: "アラート",
    keywords: ["alert", "note", "callout", "hosoku"],
    convertible: true,
  },
  {
    id: "alertTip",
    label: "アラート: TIP",
    description: "ヒント",
    group: "アラート",
    keywords: ["alert", "tip", "callout", "hint"],
    convertible: true,
  },
  {
    id: "alertImportant",
    label: "アラート: IMPORTANT",
    description: "重要",
    group: "アラート",
    keywords: ["alert", "important", "callout", "juuyou"],
    convertible: true,
  },
  {
    id: "alertWarning",
    label: "アラート: WARNING",
    description: "警告",
    group: "アラート",
    keywords: ["alert", "warning", "callout", "keikoku"],
    convertible: true,
  },
  {
    id: "alertCaution",
    label: "アラート: CAUTION",
    description: "注意",
    group: "アラート",
    keywords: ["alert", "caution", "callout", "chuui"],
    convertible: true,
  },
  {
    id: "codeBlock",
    label: "コード",
    description: "``` のコードブロック",
    group: "基本",
    keywords: ["code", "```", "pre", "ko-do"],
    convertible: true,
  },
  {
    id: "table",
    label: "表",
    description: "3 × 3 の表",
    group: "メディア・その他",
    keywords: ["table", "hyou", "|"],
    convertible: false,
  },
  {
    id: "horizontalRule",
    label: "区切り線",
    description: "---",
    group: "メディア・その他",
    keywords: ["divider", "hr", "rule", "---", "kugiri"],
    convertible: false,
  },
  {
    id: "mathBlock",
    label: "数式",
    description: "$$ のブロック数式 (KaTeX)",
    group: "メディア・その他",
    keywords: ["math", "equation", "latex", "katex", "$$", "suushiki"],
    convertible: false,
  },
  {
    id: "image",
    label: "画像",
    description: "アップロード・ライブラリから選ぶ",
    group: "メディア・その他",
    keywords: ["image", "picture", "photo", "img", "gazou"],
    convertible: false,
  },
  {
    id: "linkCard",
    label: "リンクカード",
    description: "URL だけの段落 (公開ページでカードになる)",
    group: "メディア・その他",
    keywords: ["link", "card", "url", "embed", "bookmark", "rinku"],
    convertible: false,
  },
]

function normalize(text: string) {
  return text.normalize("NFKC").toLowerCase().replace(/\s+/g, "")
}

/**
 * 入力した文字で絞り込む。ラベル・別名の先頭一致を先に、部分一致を後に並べる。
 * 空なら全部 (定義順)。
 */
export function filterCommands(
  query: string,
  commands: SlashCommand[] = SLASH_COMMANDS,
): SlashCommand[] {
  const q = normalize(query)
  if (!q) return commands
  const scored: { command: SlashCommand; score: number; index: number }[] = []
  commands.forEach((command, index) => {
    const names = [command.label, ...command.keywords].map(normalize)
    let score = -1
    if (names.some((name) => name.startsWith(q))) score = 0
    else if (names.some((name) => name.includes(q))) score = 1
    else if (normalize(command.description).includes(q)) score = 2
    if (score >= 0) scored.push({ command, score, index })
  })
  return scored
    .sort((a, b) => a.score - b.score || a.index - b.index)
    .map((entry) => entry.command)
}
