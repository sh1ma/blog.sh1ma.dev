import handler, {
  createScheduledHandler,
  PluginBridge,
} from "@emdash-cms/cloudflare/worker"

export { PluginBridge }

const originalFetch = handler.fetch
if (!originalFetch) throw new Error("Astro Worker fetch handler is missing")

const fetch: NonNullable<typeof handler.fetch> = (request, env, context) => {
  const url = new URL(request.url)
  const siteUrl = (env as { EMDASH_SITE_URL?: string }).EMDASH_SITE_URL
  if (
    url.hostname.endsWith(".workers.dev") &&
    siteUrl &&
    url.origin !== new URL(siteUrl).origin &&
    url.pathname.startsWith("/_emdash/")
  ) {
    return new Response("Admin is unavailable on version URLs", { status: 403 })
  }
  return originalFetch(request, env, context)
}

export default {
  ...handler,
  fetch,
  scheduled: createScheduledHandler(),
}
