import { LuCalendar, LuClock, LuImageOff } from "react-icons/lu"
import { Tag } from "../Tag/Tag"

type ArticleCardProps = {
  id: string
  title: string
  description?: string
  thumbnail?: string
  publishedAt: string
  readingTime: number
  tags?: string[]
  locale?: "ja" | "en"
}

export const ArticleCard = ({
  id,
  title,
  description,
  thumbnail,
  publishedAt,
  readingTime,
  tags,
  locale = "ja",
}: ArticleCardProps) => {
  return (
    <a
      href={`${locale === "en" ? "/en" : ""}/articles/${encodeURIComponent(id)}`}
    >
      <article className="group flex items-center gap-4 rounded-xl bg-bg-surface p-4 shadow-soft transition-all hover:-translate-y-1 hover:shadow-hover">
        <div className="size-24 shrink-0 overflow-hidden rounded-lg">
          {thumbnail ? (
            <img
              src={thumbnail}
              alt={title}
              width={96}
              height={96}
              loading="lazy"
              className="size-full object-cover transition-transform duration-300 group-hover:scale-105"
            />
          ) : (
            <div className="flex size-full flex-col items-center justify-center bg-gray-100 text-gray-400">
              <LuImageOff size={24} />
              <span className="mt-1 text-xs">No Image</span>
            </div>
          )}
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-2">
          {tags && tags.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {tags.map((tag) => (
                <Tag key={tag} label={tag} size="sm" />
              ))}
            </div>
          )}

          <h3 className="text-xl font-bold leading-tight break-words text-brand-primary transition-colors group-hover:underline">
            {title}
          </h3>

          {description && (
            <p className="line-clamp-2 text-sm leading-snug text-text-secondary">
              {description}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-3 text-sm text-text-muted">
            <span className="flex items-center gap-1">
              <LuCalendar size={16} />
              <time dateTime={publishedAt}>{publishedAt}</time>
            </span>
            <span className="size-1 rounded-full bg-gray-300" />
            <span className="flex items-center gap-1">
              <LuClock size={16} />
              <span>
                {readingTime}
                {locale === "en" ? " min" : "分"}
              </span>
            </span>
          </div>
        </div>
      </article>
    </a>
  )
}
