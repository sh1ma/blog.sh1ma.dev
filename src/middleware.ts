import { defineMiddleware } from "astro:middleware"

export const onRequest = defineMiddleware(async (context, next) => {
  const { pathname, search } = context.url
  if (
    pathname.length > 1 &&
    pathname.endsWith("/") &&
    !pathname.startsWith("/_emdash/")
  ) {
    return new Response(null, {
      status: 301,
      headers: { Location: `${pathname.slice(0, -1)}${search}` },
    })
  }
  const response = await next()
  if (context.url.hostname.endsWith(".workers.dev")) {
    response.headers.set("X-Robots-Tag", "noindex")
  }
  return response
})
