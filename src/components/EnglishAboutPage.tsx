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
    note: "My strongest language. I'm used to writing it and comfortable with it, and I like that I can actually use it.",
  },
  {
    name: "Rust",
    level: 4,
    liking: "love",
    note: "I write it at work. It feels really nice to use, so I might come to love it.",
  },
  {
    name: "TypeScript",
    level: 4,
    liking: "like",
    note: "I use it both at work and on this blog. Not quite as much as Python, but I do like it.",
  },
  {
    name: "Go",
    level: 3,
    liking: "dislike",
    note: "I've used it at work. Not really my favorite.",
  },
]

const hobbies = [
  {
    title: "Reading",
    items: [
      "I like novels. I haven't been reading many lately.",
      "These days I mostly read technical books.",
    ],
  },
  {
    title: "Niconico Douga",
    items: [
      "I watch it every day.",
      'I mostly watch videos with synthetic-voice characters — especially the "Software Talk Theater" tag.',
    ],
  },
]

const projects = [
  {
    name: "sh1ma/pyne",
    tagline: "LINE for Python",
    description:
      "A library for using the LINE API from Python. Currently archived.",
    href: "https://github.com/sh1ma/pyne",
    archived: true,
  },
  {
    name: "sh1ma/voicevoxcore.go",
    tagline: "Go wrapper for VOICEVOX Core",
    description: "A wrapper that calls voicevox_core from Go, using FFI.",
    href: "https://github.com/sh1ma/voicevoxcore.go",
    archived: false,
  },
  {
    name: "sh1ma/iostrace",
    tagline: "A frida-based strace alternative for iOS",
    description:
      "A tool that provides strace-equivalent functionality for 64-bit iOS devices using frida.",
    href: "https://github.com/sh1ma/iostrace",
    archived: false,
  },
  {
    name: "sh1ma/bwpk",
    tagline: "Use Bitwarden passkeys from the CLI",
    description:
      "A CLI for using Bitwarden-stored passkeys (FIDO2/WebAuthn) from the command line, with master-password or TouchID unlock.",
    href: "https://github.com/sh1ma/bwpk",
    archived: false,
  },
  {
    name: "sh1ma/Angelic-Angel",
    tagline: "Receive tweets as a Web Push stream",
    description:
      "A server that mimics how a browser receives Web Push, then uses that channel to stream tweets in.",
    href: "https://github.com/sh1ma/Angelic-Angel",
    archived: false,
  },
  {
    name: "sh1ma/try-k3s-on-cf-workers-public",
    tagline: "Experiment: running k3s on Cloudflare Workers Containers",
    description:
      "An experiment that spins up a single-node k3s cluster inside a Cloudflare Workers Container and lets you deploy pods to it.",
    href: "https://github.com/sh1ma/try-k3s-on-cf-workers-public",
    archived: false,
  },
]

export function EnglishAboutPage() {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8" lang="en">
      <section className="mb-12 rounded-2xl bg-bg-surface p-8 shadow-soft">
        <div className="mb-6 flex flex-col items-start gap-5 sm:flex-row sm:items-center">
          <img
            src="/anon-illust.jpeg"
            alt="sh1ma's icon"
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
          I'm a software engineer. I usually work on server-side and low-level
          things.
        </p>
        <dl className="flex flex-wrap gap-x-8 gap-y-3 border-t border-border-subtle pt-6 text-sm">
          <div className="flex items-center gap-2">
            <dt className="text-text-muted">Born</dt>
            <dd className="font-medium text-text-primary">2000</dd>
          </div>
          <div className="flex items-center gap-2">
            <dt className="text-text-muted">Occupation</dt>
            <dd className="font-medium text-text-primary">Engineer</dd>
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

      <Section title="Skills" subtitle="Programming languages I often use">
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {languages.map((lang) => (
            <LanguageCard key={lang.name} language={lang} />
          ))}
        </ul>
      </Section>

      <Section title="Hobbies" subtitle="What I enjoy">
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

      <Section title="Projects" subtitle="Things I've built">
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
  love: "Love",
  like: "Like",
  neutral: "Neutral",
  dislike: "Not really",
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
    <div className="flex gap-1" title={`Proficiency ${level} / 5`}>
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
