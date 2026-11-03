type TagProps = {
  label: string
  href?: string
  size?: "sm" | "md"
}

export const Tag = ({ label, href, size = "md" }: TagProps) => {
  const sizeClasses = {
    sm: "px-2 py-0.5 text-xs",
    md: "px-3 py-1 text-sm",
  }

  const baseClasses = `
    inline-flex items-center
    rounded-full
    bg-brand-primary-light/20
    text-brand-primary
    font-medium
    transition-colors
    ${sizeClasses[size]}
  `

  if (href) {
    return (
      <a
        href={href}
        className={`${baseClasses} hover:bg-brand-primary-light/30`}
      >
        {label}
      </a>
    )
  }

  return <span className={baseClasses}>{label}</span>
}
