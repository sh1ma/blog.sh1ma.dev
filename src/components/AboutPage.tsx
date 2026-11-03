import { LuExternalLink, LuSparkles } from "react-icons/lu"
import { SiGithub, SiX, SiYoutube } from "react-icons/si"

type Language = {
  name: string
  level: 1 | 2 | 3 | 4 | 5
  liking: "love" | "like" | "neutral" | "dislike"
  note: string
}

const languages: Language[] = [
  {
    name: "Python",
    level: 5,
    liking: "love",
    note: "一番得意な言語。書き慣れていて、使えるから好き。",
  },
  {
    name: "Rust",
    level: 4,
    liking: "love",
    note: "仕事で書いている。かなり使い心地がいいので好きになりそう。",
  },
  {
    name: "TypeScript",
    level: 4,
    liking: "like",
    note: "仕事でもこのブログでも使っている。Python ほどではないけれど好きな部類。",
  },
  {
    name: "Go",
    level: 3,
    liking: "dislike",
    note: "仕事で使ったことがある。あんまり好きじゃない。",
  },
]

const hobbies = [
  {
    title: "読書",
    items: [
      "小説が好き。最近はあまり読めていない。",
      "最近は専ら技術書ばかり読んでいる。",
    ],
  },
  {
    title: "ニコニコ動画",
    items: [
      "毎日見ている。",
      "合成音声キャラが喋る動画、特に「ソフトウェアトーク劇場」タグをよく見る。",
    ],
  },
]

const projects = [
  {
    name: "sh1ma/pyne",
    tagline: "LINE for Python",
    description:
      "LINE の API を Python から扱うためのライブラリ。現在はアーカイブ済み。",
    href: "https://github.com/sh1ma/pyne",
    archived: true,
  },
  {
    name: "sh1ma/voicevoxcore.go",
    tagline: "VOICEVOX Core の Go ラッパー",
    description:
      "voicevox_core を Go から呼び出すためのラッパー。FFI を利用している。",
    href: "https://github.com/sh1ma/voicevoxcore.go",
    archived: false,
  },
  {
    name: "sh1ma/iostrace",
    tagline: "frida ベースの iOS 用 strace 代替",
    description:
      "64bit iOS デバイス向けの strace 相当を frida で実現するツール。",
    href: "https://github.com/sh1ma/iostrace",
    archived: false,
  },
  {
    name: "sh1ma/bwpk",
    tagline: "Bitwarden の passkey を CLI から使う",
    description:
      "Bitwarden に保存した passkey (FIDO2/WebAuthn) をコマンドラインから利用するための CLI。マスターパスワードや TouchID で解錠できる。",
    href: "https://github.com/sh1ma/bwpk",
    archived: false,
  },
  {
    name: "sh1ma/Angelic-Angel",
    tagline: "Web Push でツイートをストリーミング受信するサーバー",
    description:
      "ブラウザが Web Push を受け取る仕組みを模倣し、その経路経由でツイートをストリーミング受信するサーバー。",
    href: "https://github.com/sh1ma/Angelic-Angel",
    archived: false,
  },
  {
    name: "sh1ma/try-k3s-on-cf-workers-public",
    tagline: "Cloudflare Workers Containers 上で k3s を動かす実験",
    description:
      "Cloudflare Workers Containers の中に single-node の k3s クラスタを立てて、Pod をデプロイして遊べるようにする実験プロジェクト。",
    href: "https://github.com/sh1ma/try-k3s-on-cf-workers-public",
    archived: false,
  },
]

export function AboutPage() {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8">
      <section className="mb-12 rounded-2xl bg-bg-surface p-8 shadow-soft">
        <div className="mb-6 flex flex-col items-start gap-5 sm:flex-row sm:items-center">
          <img
            src="/anon-illust.jpeg"
            alt="sh1ma のアイコン"
            width={96}
            height={96}
            className="size-24 shrink-0 rounded-full object-cover shadow-soft ring-2 ring-brand-primary-light/40"
          />
          <div>
            <div className="mb-3 inline-flex items-center gap-1 rounded-full bg-brand-primary-light/20 px-3 py-1 text-xs font-medium text-brand-primary">
              <LuSparkles size={14} />
              <span>About me</span>
            </div>
            <h2 className="text-4xl font-bold tracking-tight text-text-primary">
              sh1ma
            </h2>
          </div>
        </div>
        <p className="mb-6 text-lg leading-relaxed text-text-secondary">
          エンジニアをしています。普段はサーバーサイドや低レイヤ寄りのことを触ることが多いです。
        </p>
        <dl className="flex flex-wrap gap-x-8 gap-y-3 border-t border-border-subtle pt-6 text-sm">
          <div className="flex items-center gap-2">
            <dt className="text-text-muted">生まれ</dt>
            <dd className="font-medium text-text-primary">2000 年</dd>
          </div>
          <div className="flex items-center gap-2">
            <dt className="text-text-muted">職業</dt>
            <dd className="font-medium text-text-primary">エンジニア</dd>
          </div>
          <div className="flex items-center gap-2">
            <dt className="text-text-muted">GitHub</dt>
            <dd>
              <a
                href="https://github.com/sh1ma"
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-1 font-medium text-brand-primary hover:underline"
              >
                <SiGithub size={14} />
                @sh1ma
              </a>
            </dd>
          </div>
          <div className="flex items-center gap-2">
            <dt className="text-text-muted">X</dt>
            <dd>
              <a
                href="https://x.com/sh1ma"
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-1 font-medium text-brand-primary hover:underline"
              >
                <SiX size={14} />
                @sh1ma
              </a>
            </dd>
          </div>
          <div className="flex items-center gap-2">
            <dt className="text-text-muted">YouTube</dt>
            <dd>
              <a
                href="https://www.youtube.com/@am1hs"
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-1 font-medium text-brand-primary hover:underline"
              >
                <SiYoutube size={14} />
                @am1hs
              </a>
            </dd>
          </div>
        </dl>
      </section>

      <Section title="Skills" subtitle="よく使うプログラミング言語">
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {languages.map((lang) => (
            <LanguageCard key={lang.name} language={lang} />
          ))}
        </ul>
      </Section>

      <Section title="Hobbies" subtitle="趣味">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {hobbies.map((hobby) => (
            <div
              key={hobby.title}
              className="rounded-xl bg-bg-surface p-5 shadow-soft"
            >
              <h4 className="mb-3 text-lg font-bold text-text-primary">
                {hobby.title}
              </h4>
              <ul className="flex flex-col gap-2 text-sm leading-relaxed text-text-secondary">
                {hobby.items.map((item) => (
                  <li key={item} className="flex gap-2">
                    <span
                      aria-hidden
                      className="mt-2 size-1 shrink-0 rounded-full bg-brand-primary"
                    />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Projects" subtitle="作ったもの">
        <ul className="flex flex-col gap-4">
          {projects.map((project) => (
            <li key={project.name}>
              <a
                href={project.href}
                target="_blank"
                rel="noreferrer noopener"
                className="group flex flex-col gap-2 rounded-xl bg-bg-surface p-5 shadow-soft transition-all hover:-translate-y-1 hover:shadow-hover"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <SiGithub
                    size={18}
                    className="text-text-muted group-hover:text-brand-primary"
                  />
                  <h4 className="text-lg font-bold text-brand-primary group-hover:underline">
                    {project.name}
                  </h4>
                  {project.archived && (
                    <span className="rounded-full bg-bg-muted px-2 py-0.5 text-xs font-medium text-text-muted">
                      Archived
                    </span>
                  )}
                  <LuExternalLink
                    size={14}
                    className="text-text-muted opacity-0 transition-opacity group-hover:opacity-100"
                  />
                </div>
                <p className="text-sm font-medium text-text-secondary">
                  {project.tagline}
                </p>
                <p className="text-sm leading-relaxed text-text-secondary">
                  {project.description}
                </p>
              </a>
            </li>
          ))}
        </ul>
      </Section>
    </main>
  )
}

function Section({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle: string
  children: React.ReactNode
}) {
  return (
    <section className="mb-12">
      <div className="mb-6 flex items-baseline justify-between border-b border-border-subtle pb-3">
        <h3 className="text-2xl font-bold text-text-primary">{title}</h3>
        <span className="text-sm text-text-muted">{subtitle}</span>
      </div>
      {children}
    </section>
  )
}

const likingLabel: Record<Language["liking"], string> = {
  love: "好き",
  like: "好き",
  neutral: "普通",
  dislike: "そんなに",
}

const likingClass: Record<Language["liking"], string> = {
  love: "bg-accent-pink/15 text-accent-pink",
  like: "bg-brand-primary-light/20 text-brand-primary",
  neutral: "bg-bg-muted text-text-muted",
  dislike: "bg-accent-yellow/20 text-accent-yellow",
}

function LanguageCard({ language }: { language: Language }) {
  return (
    <li className="flex flex-col gap-3 rounded-xl bg-bg-surface p-5 shadow-soft">
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-lg font-bold text-text-primary">{language.name}</h4>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${likingClass[language.liking]}`}
        >
          {likingLabel[language.liking]}
        </span>
      </div>
      <ProficiencyMeter level={language.level} />
      <p className="text-sm leading-relaxed text-text-secondary">
        {language.note}
      </p>
    </li>
  )
}

function ProficiencyMeter({ level }: { level: Language["level"] }) {
  return (
    <div className="flex gap-1" title={`習熟度 ${level} / 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <span
          key={n}
          className={`h-1.5 flex-1 rounded-full ${
            n <= level ? "bg-brand-primary" : "bg-bg-muted"
          }`}
        />
      ))}
    </div>
  )
}
