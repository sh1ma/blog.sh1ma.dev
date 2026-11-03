import { LuLanguages } from "react-icons/lu"

type TranslationNoticeProps = {
  targetLocale: "ja" | "en"
  href: string
}

const messages = {
  en: {
    text: "An English version of this article is available.",
    linkText: "Read in English",
  },
  ja: {
    text: "この記事の日本語版があります。",
    linkText: "日本語で読む",
  },
} as const

export const TranslationNotice = ({
  targetLocale,
  href,
}: TranslationNoticeProps) => {
  const { text, linkText } = messages[targetLocale]
  return (
    <div
      className="mb-6 flex items-center gap-3 rounded-lg border border-brand-primary/20 bg-brand-primary-light/10 px-4 py-3 text-sm text-text-primary"
      lang={targetLocale}
    >
      <LuLanguages size={18} className="shrink-0 text-brand-primary" />
      <span className="flex-1">{text}</span>
      <a
        href={href}
        className="whitespace-nowrap font-medium text-brand-primary hover:underline"
      >
        {linkText}
      </a>
    </div>
  )
}
