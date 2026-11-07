import { LuPenLine } from "react-icons/lu"
import { SiGithub, SiRss } from "react-icons/si"

export const Footer = ({ pathname = "/" }: { pathname?: string }) => {
  const currentYear = new Date().getFullYear()
  const isEnglish = pathname === "/en" || pathname.startsWith("/en/")

  return (
    <footer className="border-t border-gray-200 bg-bg-surface">
      <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-6 px-4 py-10 sm:px-6 md:flex-row lg:px-8">
        <div className="text-center md:text-left">
          <div className="mb-2 flex items-center justify-center gap-2 md:justify-start">
            <div className="bg-brand-primary/10 flex size-6 items-center justify-center rounded-md text-brand-primary">
              <LuPenLine size={16} />
            </div>
            <span className="text-lg font-bold text-text-primary">
              blog.<span className="text-brand-primary">sh1ma.dev</span>
            </span>
          </div>
          <p className="text-sm text-text-muted">
            © {currentYear} sh1ma. All rights reserved.
          </p>
          <p
            className="mt-2 text-xs text-text-muted"
            lang={isEnglish ? "en" : "ja"}
          >
            {isEnglish
              ? "This site uses Cloudflare Web Analytics for access analytics."
              : "このサイトはアクセス解析のため Cloudflare Web Analytics を利用しています。"}
          </p>
        </div>

        <div className="flex gap-6">
          <a
            href="https://github.com/sh1ma"
            target="_blank"
            rel="noopener noreferrer"
            className="text-text-muted transition-all duration-300 hover:-translate-y-1 hover:text-brand-primary"
            aria-label="GitHub"
          >
            <SiGithub className="size-5" />
          </a>
          <a
            href="/feed"
            className="text-text-muted transition-all duration-300 hover:-translate-y-1 hover:text-brand-primary"
            aria-label="RSS"
          >
            <SiRss className="size-5" />
          </a>
        </div>
      </div>
    </footer>
  )
}
