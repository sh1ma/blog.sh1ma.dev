import handler, {
  createScheduledHandler,
  PluginBridge,
} from "@emdash-cms/cloudflare/worker"

export { PluginBridge }

const originalFetch = handler.fetch
if (!originalFetch) throw new Error("Astro Worker fetch handler is missing")

const fetch: NonNullable<typeof handler.fetch> = (request, env, context) => {
  const url = new URL(request.url)
  const settings = env as {
    EMDASH_SITE_URL?: string
    EMDASH_ADMIN_DISABLED?: string
  }
  const siteUrl = settings.EMDASH_SITE_URL
  if (
    url.pathname.startsWith("/_emdash/") &&
    (settings.EMDASH_ADMIN_DISABLED === "1" ||
      (url.hostname.endsWith(".workers.dev") &&
        siteUrl &&
        url.origin !== new URL(siteUrl).origin))
  ) {
    return new Response("Admin is unavailable on this host", { status: 403 })
  }
  return originalFetch(request, env, context)
}

export default {
  ...handler,
  fetch,
  scheduled: createScheduledHandler(),
}
