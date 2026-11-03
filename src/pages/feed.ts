import type { APIRoute } from "astro"
import { buildFeed } from "../lib/feed"

export const GET: APIRoute = ({ site, url }) =>
  buildFeed("ja", (site ?? url).origin)
