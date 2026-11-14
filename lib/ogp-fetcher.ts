import cachedOgp from "../src/data/ogp-cache.json"

// リンクカードの OGP。
// - 公開ページの描画 (rehype-rich-embeds) は保存済みの値 (プラグインのストレージ → この JSON)
//   を読むだけで、表示のたびに外へは取りに行かない。
// - 取得 (fetchOgpRecord) は記事の保存時と管理画面のプレビューのときだけ、
//   リンクカードのプラグイン (src/plugins/link-cards) から呼ぶ。
// HTML の解析は正規表現と最小限の属性パーサで行う (Workers に重いパーサを入れない)。

export type OgpData = {
  url: string
  title: string
  description?: string
  image?: string
  siteName?: string
  favicon?: string
  domain: string
}

/** プラグインのストレージに保存する 1 件 (キーは normalizeOgpUrl した URL) */
export type OgpRecord = {
  url: string
  /** 取れなかったときは null (公開ページは URL と favicon だけのカードになる) */
  data: OgpData | null
  /** 取得した (試みた) 時刻 (ms) */
  fetchedAt: number
  /** 失敗の理由 */
  error?: string
  /** 失敗したとき、この時刻 (ms) までは自動では取り直さない */
  retryAfter?: number
}

type CacheEntry = { data: OgpData | null }

const legacyCache: Record<string, CacheEntry> = cachedOgp

export const OGP_USER_AGENT =
  "blog.sh1ma.dev link-card bot (+https://blog.sh1ma.dev)"
export const OGP_TIMEOUT_MS = 5_000
export const OGP_MAX_REDIRECTS = 5
export const OGP_MAX_BYTES = 1024 * 1024
/** 失敗した URL を自動では取り直さない時間 */
export const OGP_RETRY_INTERVAL_MS = 24 * 60 * 60 * 1000
/** ストレージのキーの上限 (EmDash の plugins/conditional-storage.ts の MAX_KEY_LENGTH) */
const MAX_KEY_LENGTH = 1024

// ---------------------------------------------------------------------------
// URL
// ---------------------------------------------------------------------------

/** ストレージのキーにする URL。http(s) 以外・解釈できないものは null */
export function normalizeOgpUrl(raw: string): string | null {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    return null
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null
  const href = url.href
  return href.length <= MAX_KEY_LENGTH ? href : null
}

export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "")
  } catch {
    return url
  }
}

/** favicon が無いときに使う Google の favicon サービス (rehype-rich-embeds の簡易カードと同じ) */
export function googleFavicon(domain: string): string {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`
}

/** URL と favicon だけのカード (OGP が無い・HTML でないとき) */
export function urlOnlyOgp(url: string): OgpData {
  const domain = domainOf(url)
  return { url, title: url, domain, favicon: googleFavicon(domain) }
}

// ---------------------------------------------------------------------------
// 取りに行ってよい URL か
// ---------------------------------------------------------------------------

function parseIpv4(host: string): number[] | null {
  const parts = host.split(".")
  if (parts.length !== 4) return null
  const nums = parts.map((part) =>
    /^(?:0|[1-9]\d{0,2})$/.test(part) ? Number(part) : Number.NaN,
  )
  return nums.every((n) => n >= 0 && n <= 255) ? nums : null
}

function blockedIpv4([a, b]: number[]): string | null {
  if (a === 0) return "0.0.0.0/8"
  if (a === 10) return "プライベート (10.0.0.0/8)"
  if (a === 100 && b >= 64 && b <= 127) return "共有アドレス (100.64.0.0/10)"
  if (a === 127) return "ループバック (127.0.0.0/8)"
  if (a === 169 && b === 254) return "リンクローカル (169.254.0.0/16)"
  if (a === 172 && b >= 16 && b <= 31) return "プライベート (172.16.0.0/12)"
  if (a === 192 && b === 168) return "プライベート (192.168.0.0/16)"
  if (a === 192 && b === 0) return "予約済み (192.0.0.0/24)"
  if (a === 198 && (b === 18 || b === 19))
    return "ベンチマーク用 (198.18.0.0/15)"
  if (a >= 224) return "マルチキャスト・予約済み (224.0.0.0/3)"
  return null
}

/** IPv6 を 16 bit × 8 に。:: と末尾の IPv4 表記に対応する */
function parseIpv6(host: string): number[] | null {
  let address = host
  if (address.includes(".")) {
    const at = address.lastIndexOf(":")
    const v4 = parseIpv4(address.slice(at + 1))
    if (at < 0 || !v4) return null
    address = `${address.slice(0, at + 1)}${((v4[0] << 8) | v4[1]).toString(16)}:${((v4[2] << 8) | v4[3]).toString(16)}`
  }
  const halves = address.split("::")
  if (halves.length > 2) return null
  const head = halves[0] ? halves[0].split(":") : []
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : []
  const missing = 8 - head.length - tail.length
  if (halves.length === 2 ? missing < 1 : missing !== 0) return null
  const groups = [...head, ...Array(Math.max(missing, 0)).fill("0"), ...tail]
  if (!groups.every((g) => /^[0-9a-f]{1,4}$/i.test(g))) return null
  return groups.map((g) => Number.parseInt(g, 16))
}

function blockedIpv6(g: number[]): string | null {
  const zeros = (from: number, to: number) =>
    g.slice(from, to).every((x) => x === 0)
  const embedded = (hi: number, lo: number) =>
    blockedIpv4([hi >> 8, hi & 0xff, lo >> 8, lo & 0xff])
  if (zeros(0, 8)) return "未指定アドレス (::)"
  if (zeros(0, 7) && g[7] === 1) return "ループバック (::1)"
  // IPv4 射影 (::ffff:a.b.c.d) / IPv4 互換 (::a.b.c.d) / NAT64 (64:ff9b::a.b.c.d)
  if (zeros(0, 5) && (g[5] === 0xffff || g[5] === 0)) {
    const v4 = embedded(g[6], g[7])
    if (v4) return `IPv4 埋め込み: ${v4}`
  }
  if (g[0] === 0x64 && g[1] === 0xff9b && zeros(2, 6)) {
    const v4 = embedded(g[6], g[7])
    if (v4) return `NAT64: ${v4}`
  }
  if (g[0] === 0x2002) {
    const v4 = embedded(g[1], g[2])
    if (v4) return `6to4: ${v4}`
  }
  if ((g[0] & 0xffc0) === 0xfe80) return "リンクローカル (fe80::/10)"
  if ((g[0] & 0xffc0) === 0xfec0) return "サイトローカル (fec0::/10)"
  if ((g[0] & 0xfe00) === 0xfc00) return "ユニークローカル (fc00::/7)"
  if ((g[0] & 0xff00) === 0xff00) return "マルチキャスト (ff00::/8)"
  return null
}

export type UrlCheck = { ok: true; url: URL } | { ok: false; reason: string }

/**
 * OGP を取りに行ってよい URL か。http(s) だけ、認証情報なし、
 * localhost・*.local・*.internal と、IP リテラルのプライベート / ループバック /
 * リンクローカルなどは拒否する。ホスト名の名前解決の結果までは見ない
 * (Workers からは内部ネットワークに届かないが、Node で動かすときは注意)。
 */
export function checkFetchableUrl(raw: string): UrlCheck {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return { ok: false, reason: "URL として解釈できません" }
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, reason: `${url.protocol} は取得できません` }
  }
  if (url.username || url.password) {
    return { ok: false, reason: "認証情報付きの URL は取得できません" }
  }
  const host = url.hostname
    .replace(/^\[|\]$/g, "")
    .toLowerCase()
    .replace(/\.+$/, "")
  if (!host) return { ok: false, reason: "ホストがありません" }
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal")
  ) {
    return { ok: false, reason: `内部向けのホスト名です (${host})` }
  }
  // WHATWG の URL は 0x7f.1 や 2130706433 のような IPv4 も 127.0.0.1 に直す
  const v4 = parseIpv4(host)
  if (v4) {
    const blocked = blockedIpv4(v4)
    return blocked
      ? { ok: false, reason: `内部向けの IP アドレスです: ${blocked}` }
      : { ok: true, url }
  }
  if (host.includes(":")) {
    const v6 = parseIpv6(host)
    if (!v6) return { ok: false, reason: "IPv6 アドレスとして解釈できません" }
    const blocked = blockedIpv6(v6)
    return blocked
      ? { ok: false, reason: `内部向けの IP アドレスです: ${blocked}` }
      : { ok: true, url }
  }
  return { ok: true, url }
}

// ---------------------------------------------------------------------------
// HTML の解析
// ---------------------------------------------------------------------------

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  hellip: "…",
  mdash: "—",
  ndash: "–",
  middot: "·",
  bull: "•",
  laquo: "«",
  raquo: "»",
  lsquo: "‘",
  rsquo: "’",
  ldquo: "“",
  rdquo: "”",
  copy: "©",
  reg: "®",
  trade: "™",
  yen: "¥",
  euro: "€",
  times: "×",
}

/** HTML の文字参照を戻す (数値参照と、よく出る名前付き参照) */
export function decodeEntities(text: string): string {
  return text.replace(
    /&(?:#(\d{1,7})|#[xX]([0-9a-fA-F]{1,6})|([a-zA-Z][a-zA-Z0-9]{1,31}));?/g,
    (match, dec?: string, hex?: string, name?: string) => {
      if (dec || hex) {
        const code = Number.parseInt(dec ?? hex ?? "", dec ? 10 : 16)
        if (code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff))
          return "�"
        return String.fromCodePoint(code)
      }
      const value = NAMED_ENTITIES[(name ?? "").toLowerCase()]
      return value ?? match
    },
  )
}

const ATTR_RE =
  /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g

/** タグ 1 つ (`<meta ...>`) の属性。名前は小文字、値は文字参照を戻す */
export function parseAttributes(tag: string): Record<string, string> {
  const inner = tag.replace(/^<[a-zA-Z][^\s/>]*/, "").replace(/\/?>$/, "")
  const attrs: Record<string, string> = {}
  for (const m of inner.matchAll(ATTR_RE)) {
    const name = m[1].toLowerCase()
    if (name in attrs) continue
    attrs[name] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? "")
  }
  return attrs
}

function clean(value: string | undefined, max: number): string | undefined {
  const text = value?.replace(/\s+/g, " ").trim()
  if (!text) return undefined
  return text.length > max ? text.slice(0, max) : text
}

function absoluteHttpUrl(value: string | undefined, base: string) {
  if (!value) return undefined
  try {
    const url = new URL(value.trim(), base)
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined
    return url.href.length <= 2048 ? url.href : undefined
  } catch {
    return undefined
  }
}

/** コメント・script・style を除いた <head> 部分 (無ければ全体) */
function headOf(html: string): string {
  const stripped = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|noscript|template)\b[\s\S]*?<\/\1\s*>/gi, "")
  const end = stripped.search(/<\/head\s*>|<body[\s>]/i)
  return end >= 0 ? stripped.slice(0, end) : stripped
}

/**
 * HTML から OGP を取り出す。
 * title: og:title → twitter:title → <title>、description も同じ順 (最後は meta description)、
 * image: og:image (相対 URL は絶対化)、favicon: <link rel="icon"> → Google の favicon サービス。
 * @param html 文字列に直した HTML
 * @param pageUrl 最終的に取得したページの URL (相対 URL の基準)
 * @param url カードのリンク先 (記事に書かれた URL)
 */
export function parseOgpHtml(
  html: string,
  pageUrl: string,
  url: string = pageUrl,
): OgpData {
  const head = headOf(html)
  const meta = new Map<string, string>()
  for (const [tag] of head.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs = parseAttributes(tag)
    const key = (attrs.property ?? attrs.name ?? "").trim().toLowerCase()
    if (key && attrs.content !== undefined && !meta.has(key)) {
      meta.set(key, attrs.content)
    }
  }

  let base = pageUrl
  const baseTag = head.match(/<base\b[^>]*>/i)
  if (baseTag) {
    base = absoluteHttpUrl(parseAttributes(baseTag[0]).href, pageUrl) ?? base
  }

  const titleTag = head.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i)
  const first = (...keys: string[]) =>
    keys.map((key) => meta.get(key)).find((value) => value?.trim())

  let favicon: string | undefined
  for (const [tag] of head.matchAll(/<link\b[^>]*>/gi)) {
    const attrs = parseAttributes(tag)
    const rel = (attrs.rel ?? "").toLowerCase().split(/\s+/)
    if (!rel.includes("icon")) continue
    favicon = absoluteHttpUrl(attrs.href, base)
    if (favicon) break
  }

  const domain = domainOf(url)
  return {
    url,
    title:
      clean(
        first("og:title", "twitter:title") ??
          (titleTag ? decodeEntities(titleTag[1]) : undefined),
        300,
      ) ?? url,
    description: clean(
      first("og:description", "twitter:description", "description"),
      1000,
    ),
    image: absoluteHttpUrl(
      first("og:image", "og:image:url", "og:image:secure_url", "twitter:image"),
      base,
    ),
    siteName: clean(first("og:site_name"), 200),
    favicon: favicon ?? googleFavicon(domain),
    domain,
  }
}

// ---------------------------------------------------------------------------
// 文字コード
// ---------------------------------------------------------------------------

function charsetFromContentType(contentType: string | null): string | null {
  const match = contentType?.match(/charset\s*=\s*["']?([^"';\s]+)/i)
  return match ? match[1] : null
}

/** バイト列を 1 バイト 1 文字の文字列にする (タグや charset を探すだけなので ASCII 以外は崩れてよい) */
function bytesToAscii(bytes: Uint8Array): string {
  let text = ""
  for (let i = 0; i < bytes.length; i += 8192) {
    text += String.fromCharCode(...bytes.subarray(i, i + 8192))
  }
  return text
}

/** 先頭 (最大 4KB) の <meta charset> / http-equiv から文字コードを読む */
function charsetFromMeta(bytes: Uint8Array): string | null {
  const prefix = bytesToAscii(bytes.subarray(0, 4096))
  for (const [tag] of prefix.matchAll(/<meta\b[^>]*>/gi)) {
    const attrs = parseAttributes(tag)
    if (attrs.charset) return attrs.charset.trim()
    if (attrs["http-equiv"]?.toLowerCase() === "content-type") {
      const charset = charsetFromContentType(attrs.content ?? null)
      if (charset) return charset
    }
  }
  return null
}

/** BOM → Content-Type の charset → <meta> の順で文字コードを決めて文字列にする */
export function decodeHtml(
  bytes: Uint8Array,
  contentType: string | null,
): string {
  let label: string | null = null
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf)
    label = "utf-8"
  else if (bytes[0] === 0xfe && bytes[1] === 0xff) label = "utf-16be"
  else if (bytes[0] === 0xff && bytes[1] === 0xfe) label = "utf-16le"
  label ??= charsetFromContentType(contentType) ?? charsetFromMeta(bytes)
  try {
    return new TextDecoder(label ?? "utf-8").decode(bytes)
  } catch {
    // 実行環境が知らない文字コード
    return new TextDecoder("utf-8").decode(bytes)
  }
}

// ---------------------------------------------------------------------------
// 取得
// ---------------------------------------------------------------------------

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>

export type FetchOgpOptions = {
  fetch?: FetchLike
  now?: () => number
  timeoutMs?: number
  maxBytes?: number
  maxRedirects?: number
}

function isHtml(contentType: string | null): boolean {
  const type = contentType?.split(";")[0].trim().toLowerCase()
  return type === "text/html" || type === "application/xhtml+xml"
}

/** maxBytes まで読む。</head> まで読めたらそこで打ち切る */
async function readLimited(
  response: Response,
  maxBytes: number,
): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array(await response.arrayBuffer())
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  let window = ""
  try {
    while (total < maxBytes) {
      const { done, value } = await reader.read()
      if (done) break
      const chunk =
        value.byteLength > maxBytes - total
          ? value.subarray(0, maxBytes - total)
          : value
      chunks.push(chunk)
      total += chunk.byteLength
      window = (window + bytesToAscii(chunk)).slice(-4096)
      if (/<\/head\s*>/i.test(window)) break
    }
  } finally {
    await reader.cancel().catch(() => {})
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

function failure(url: string, now: number, error: string): OgpRecord {
  return {
    url,
    data: null,
    fetchedAt: now,
    error,
    retryAfter: now + OGP_RETRY_INTERVAL_MS,
  }
}

/**
 * URL の OGP を取得する。例外は投げず、失敗も OgpRecord (data: null) で返す。
 * - リダイレクトは手で最大 maxRedirects 回たどり、各ホップで checkFetchableUrl する
 * - 全体のタイムアウト・本文の上限 (</head> まで読めれば打ち切る)
 * - HTML でなければ URL だけのカード
 */
export async function fetchOgpRecord(
  rawUrl: string,
  options: FetchOgpOptions = {},
): Promise<OgpRecord> {
  const now = (options.now ?? Date.now)()
  const doFetch: FetchLike =
    options.fetch ?? ((input, init) => globalThis.fetch(input, init))
  const url = normalizeOgpUrl(rawUrl) ?? rawUrl
  const maxRedirects = options.maxRedirects ?? OGP_MAX_REDIRECTS

  const controller = new AbortController()
  const timer = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? OGP_TIMEOUT_MS,
  )
  try {
    let current = url
    for (let hop = 0; ; hop++) {
      const check = checkFetchableUrl(current)
      if (!check.ok) return failure(url, now, check.reason)
      const response = await doFetch(check.url.href, {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
        headers: {
          "User-Agent": OGP_USER_AGENT,
          Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.1",
          "Accept-Language": "ja,en;q=0.8",
        },
      })
      const location = response.headers.get("location")
      if (response.status >= 300 && response.status < 400 && location) {
        await response.body?.cancel().catch(() => {})
        if (hop >= maxRedirects) {
          return failure(
            url,
            now,
            `リダイレクトが多すぎます (${maxRedirects} 回まで)`,
          )
        }
        current = new URL(location, check.url).href
        continue
      }
      if (!response.ok) {
        await response.body?.cancel().catch(() => {})
        return failure(url, now, `HTTP ${response.status}`)
      }
      const contentType = response.headers.get("content-type")
      if (!isHtml(contentType)) {
        await response.body?.cancel().catch(() => {})
        return { url, data: urlOnlyOgp(url), fetchedAt: now }
      }
      const bytes = await readLimited(
        response,
        options.maxBytes ?? OGP_MAX_BYTES,
      )
      const html = decodeHtml(bytes, contentType)
      return {
        url,
        data: parseOgpHtml(html, check.url.href, url),
        fetchedAt: now,
      }
    }
  } catch (error) {
    const aborted = controller.signal.aborted
    return failure(
      url,
      now,
      aborted
        ? "タイムアウトしました"
        : `取得できませんでした: ${error instanceof Error ? error.message : String(error)}`,
    )
  } finally {
    clearTimeout(timer)
  }
}

/** 自動で (保存時・プレビューで) 取り直してよいか。成功したものは取り直さない */
export function shouldFetch(
  record: OgpRecord | null | undefined,
  now: number,
): boolean {
  if (!record) return true
  if (record.data) return false
  return (record.retryAfter ?? 0) <= now
}

// ---------------------------------------------------------------------------
// 保存済みの値を読む (公開ページ)
// ---------------------------------------------------------------------------

/** 移行前から持っている OGP (src/data/ogp-cache.json) */
export function legacyOgp(url: string): OgpData | null {
  const normalized = normalizeOgpUrl(url)
  return (
    legacyCache[url]?.data ??
    (normalized ? legacyCache[normalized]?.data : null) ??
    null
  )
}

/** 保存済みのレコードを normalizeOgpUrl したキーで引く */
export type StoredOgpReader = (
  keys: string[],
) => Promise<Map<string, OgpRecord>>

export type OgpResolver = (urls: string[]) => Promise<Map<string, OgpData>>

/**
 * 公開ページ用。ストレージ → JSON の順で引き、どちらにも無い URL は結果に入れない
 * (呼び出し側が簡易カードにする)。ストレージを読めないとき (テスト・ビルド時など) は JSON だけ。
 */
export function createOgpResolver(read?: StoredOgpReader): OgpResolver {
  return async (urls) => {
    const keys = [
      ...new Set(
        urls.map(normalizeOgpUrl).filter((key): key is string => !!key),
      ),
    ]
    let stored = new Map<string, OgpRecord>()
    if (read && keys.length > 0) {
      try {
        stored = await read(keys)
      } catch {
        stored = new Map()
      }
    }
    const result = new Map<string, OgpData>()
    for (const url of urls) {
      const key = normalizeOgpUrl(url)
      const data = (key ? stored.get(key)?.data : null) ?? legacyOgp(url)
      if (data) result.set(url, data)
    }
    return result
  }
}

export const legacyOgpResolver: OgpResolver = createOgpResolver()
