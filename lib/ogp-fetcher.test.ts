import { describe, expect, it } from "vitest"
import {
  checkFetchableUrl,
  createOgpResolver,
  decodeEntities,
  decodeHtml,
  type FetchLike,
  fetchOgpRecord,
  legacyOgp,
  normalizeOgpUrl,
  OGP_RETRY_INTERVAL_MS,
  OGP_USER_AGENT,
  type OgpRecord,
  parseOgpHtml,
  shouldFetch,
} from "./ogp-fetcher"

const PAGE = "https://example.com/articles/1"

describe("parseOgpHtml", () => {
  it("og:* がすべてあるとき", () => {
    const html = `<!doctype html><html><head>
      <meta charset="utf-8">
      <title>Title tag</title>
      <meta property="og:title" content="OG Title">
      <meta property="og:description" content="OG description">
      <meta property="og:image" content="https://cdn.example.com/og.png">
      <meta property="og:site_name" content="Example Site">
      <meta name="twitter:title" content="Twitter Title">
      <link rel="icon" href="/favicon.ico">
    </head><body><p>body</p></body></html>`
    expect(parseOgpHtml(html, PAGE)).toEqual({
      url: PAGE,
      title: "OG Title",
      description: "OG description",
      image: "https://cdn.example.com/og.png",
      siteName: "Example Site",
      favicon: "https://example.com/favicon.ico",
      domain: "example.com",
    })
  })

  it("<title> だけのとき (favicon は Google のサービス)", () => {
    const html = "<html><head><title>  Only\n  title </title></head></html>"
    expect(parseOgpHtml(html, "https://www.example.org/")).toEqual({
      url: "https://www.example.org/",
      title: "Only title",
      description: undefined,
      image: undefined,
      siteName: undefined,
      favicon: "https://www.google.com/s2/favicons?domain=example.org&sz=64",
      domain: "example.org",
    })
  })

  it("相対の og:image・favicon を絶対 URL にする (<base> も見る)", () => {
    const html = `<head>
      <meta property="og:image" content="../img/card.png">
      <link rel="shortcut icon" href="icons/fav.png">
    </head>`
    const data = parseOgpHtml(html, PAGE)
    expect(data.image).toBe("https://example.com/img/card.png")
    expect(data.favicon).toBe("https://example.com/articles/icons/fav.png")

    const withBase = parseOgpHtml(
      `<head><base href="https://static.example.net/x/"><meta property="og:image" content="card.png"></head>`,
      PAGE,
    )
    expect(withBase.image).toBe("https://static.example.net/x/card.png")
  })

  it("twitter:* と meta description に落ちる。属性の順・引用符の違いを許す", () => {
    const html = `<head>
      <META content='Tw title' name=twitter:title>
      <meta content="Plain description" name="description">
      <meta name="twitter:image" content="//img.example.com/a.jpg">
    </head>`
    const data = parseOgpHtml(html, PAGE)
    expect(data.title).toBe("Tw title")
    expect(data.description).toBe("Plain description")
    expect(data.image).toBe("https://img.example.com/a.jpg")
  })

  it("HTML の文字参照を戻す", () => {
    const html = `<head>
      <meta property="og:title" content="Tom &amp; Jerry &#x2014; &quot;quoted&quot; &#12354;">
      <meta property="og:description" content="a&hellip; &lt;b&gt; &unknown; &nbsp;x">
      <title>ignored</title>
    </head>`
    const data = parseOgpHtml(html, PAGE)
    expect(data.title).toBe('Tom & Jerry — "quoted" あ')
    expect(data.description).toBe("a… <b> &unknown; x")
  })

  it("<body> や script の中の meta は見ない。data: や javascript: の画像は使わない", () => {
    const html = `<head>
      <script>var s = '<meta property="og:title" content="from script">'</script>
      <!-- <meta property="og:title" content="from comment"> -->
      <meta property="og:image" content="javascript:alert(1)">
      <link rel="icon" href="data:image/png;base64,AAAA">
      <title>Real</title>
    </head><body><meta property="og:title" content="from body"></body>`
    const data = parseOgpHtml(html, PAGE)
    expect(data.title).toBe("Real")
    expect(data.image).toBeUndefined()
    expect(data.favicon).toContain("google.com/s2/favicons")
  })

  it("リンク先 (記事に書かれた URL) とリダイレクト後のページの URL を分けて扱う", () => {
    const data = parseOgpHtml(
      '<head><meta property="og:image" content="/a.png"></head>',
      "https://new.example.com/page",
      "https://old.example.com/page",
    )
    expect(data.url).toBe("https://old.example.com/page")
    expect(data.image).toBe("https://new.example.com/a.png")
  })
})

describe("decodeEntities", () => {
  it("壊れた数値参照は置換文字にする", () => {
    expect(decodeEntities("&#0;&#xD800;&#1114112;")).toBe("���")
  })
})

/** "<title>日本語</title>" を Shift_JIS で */
function shiftJisHtml(meta: string) {
  const ascii = (text: string) => [...text].map((c) => c.charCodeAt(0))
  return new Uint8Array([
    ...ascii(`<html><head>${meta}<title>`),
    0x93,
    0xfa,
    0x96,
    0x7b,
    0x8c,
    0xea,
    ...ascii("</title></head></html>"),
  ])
}

describe("decodeHtml", () => {
  it("Content-Type の charset (Shift_JIS)", () => {
    const html = decodeHtml(shiftJisHtml(""), "text/html; charset=Shift_JIS")
    expect(parseOgpHtml(html, PAGE).title).toBe("日本語")
  })

  it("<meta charset> (Shift_JIS)", () => {
    const html = decodeHtml(
      shiftJisHtml('<meta charset="shift_jis">'),
      "text/html",
    )
    expect(parseOgpHtml(html, PAGE).title).toBe("日本語")
  })

  it("<meta http-equiv> (Shift_JIS)", () => {
    const html = decodeHtml(
      shiftJisHtml(
        '<meta http-equiv="Content-Type" content="text/html; charset=Shift_JIS">',
      ),
      null,
    )
    expect(parseOgpHtml(html, PAGE).title).toBe("日本語")
  })

  it("指定が無ければ UTF-8。知らない文字コードも UTF-8", () => {
    const bytes = new TextEncoder().encode("<title>ユニコード</title>")
    expect(decodeHtml(bytes, "text/html")).toContain("ユニコード")
    expect(decodeHtml(bytes, "text/html; charset=x-unknown")).toContain(
      "ユニコード",
    )
  })
})

describe("checkFetchableUrl", () => {
  const rejected: [string, string][] = [
    ["ftp://example.com/", "スキーム"],
    ["file:///etc/passwd", "スキーム"],
    ["javascript:alert(1)", "スキーム"],
    ["https://user:pass@example.com/", "認証情報"],
    ["http://localhost/", "localhost"],
    ["http://LOCALHOST.:8080/", "localhost (末尾のドット)"],
    ["http://foo.localhost/", "*.localhost"],
    ["http://printer.local/", "*.local"],
    ["http://metadata.google.internal/", "*.internal"],
    ["http://127.0.0.1/", "ループバック"],
    ["http://127.1/", "ループバック (省略形)"],
    ["http://2130706433/", "ループバック (10 進)"],
    ["http://0x7f.0.0.1/", "ループバック (16 進)"],
    ["http://0.0.0.0/", "0.0.0.0/8"],
    ["http://10.1.2.3/", "プライベート 10/8"],
    ["http://172.16.0.1/", "プライベート 172.16/12"],
    ["http://172.31.255.255/", "プライベート 172.16/12 の端"],
    ["http://192.168.1.1/", "プライベート 192.168/16"],
    ["http://169.254.169.254/latest/meta-data/", "リンクローカル (メタデータ)"],
    ["http://100.64.0.1/", "共有アドレス"],
    ["http://224.0.0.1/", "マルチキャスト"],
    ["http://[::1]/", "IPv6 ループバック"],
    ["http://[::]/", "IPv6 未指定"],
    ["http://[fe80::1]/", "IPv6 リンクローカル"],
    ["http://[fc00::1]/", "IPv6 ユニークローカル"],
    ["http://[fd12:3456::1]/", "IPv6 ユニークローカル (fd)"],
    ["http://[fec0::1]/", "IPv6 サイトローカル"],
    ["http://[ff02::1]/", "IPv6 マルチキャスト"],
    ["http://[::ffff:127.0.0.1]/", "IPv4 射影 (ループバック)"],
    ["http://[::ffff:10.0.0.1]/", "IPv4 射影 (プライベート)"],
    ["http://[::ffff:a9fe:a9fe]/", "IPv4 射影 (169.254.169.254)"],
    ["http://[64:ff9b::7f00:1]/", "NAT64 (ループバック)"],
    ["http://[2002:c0a8:101::1]/", "6to4 (192.168.1.1)"],
    ["not a url", "URL でない"],
  ]
  it.each(rejected)("拒否: %s (%s)", (url) => {
    expect(checkFetchableUrl(url).ok).toBe(false)
  })

  const allowed = [
    "https://example.com/",
    "http://example.com:8080/path?q=1#x",
    "https://93.184.215.14/",
    "https://172.32.0.1/",
    "https://192.169.0.1/",
    "https://[2606:4700:4700::1111]/",
    "https://[::ffff:8.8.8.8]/",
    "https://local.example.com/",
    "https://internal.example.com/",
  ]
  it.each(allowed)("許可: %s", (url) => {
    expect(checkFetchableUrl(url).ok).toBe(true)
  })
})

describe("normalizeOgpUrl", () => {
  it("URL の書き方の違いをそろえる。http(s) 以外は null", () => {
    expect(normalizeOgpUrl(" HTTPS://Example.COM ")).toBe(
      "https://example.com/",
    )
    expect(normalizeOgpUrl("https://example.com/a b#frag")).toBe(
      "https://example.com/a%20b#frag",
    )
    expect(normalizeOgpUrl("mailto:a@example.com")).toBeNull()
    expect(normalizeOgpUrl("not a url")).toBeNull()
    expect(normalizeOgpUrl(`https://example.com/${"a".repeat(1100)}`)).toBe(
      null,
    )
  })
})

type Call = { url: string; init: RequestInit }

function fakeFetch(
  routes: Record<string, () => Response | Promise<Response>>,
  calls: Call[] = [],
): FetchLike {
  return async (url, init) => {
    calls.push({ url, init })
    const route = routes[url]
    if (!route) throw new Error(`unexpected fetch: ${url}`)
    return route()
  }
}

const html = (body: string, headers: Record<string, string> = {}) =>
  new Response(body, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8", ...headers },
  })

const redirect = (location: string, status = 301) =>
  new Response(null, { status, headers: { location } })

describe("fetchOgpRecord", () => {
  const now = () => 1_000_000

  it("取得して解析する。User-Agent を付け、リダイレクトは手で追う", async () => {
    const calls: Call[] = []
    const record = await fetchOgpRecord("https://example.com/old", {
      now,
      fetch: fakeFetch(
        {
          "https://example.com/old": () => redirect("/new"),
          "https://example.com/new": () =>
            html('<head><meta property="og:title" content="New"></head>'),
        },
        calls,
      ),
    })
    expect(record).toEqual({
      url: "https://example.com/old",
      fetchedAt: 1_000_000,
      data: expect.objectContaining({
        url: "https://example.com/old",
        title: "New",
      }),
    })
    expect(calls.map((call) => call.url)).toEqual([
      "https://example.com/old",
      "https://example.com/new",
    ])
    expect(calls[0].init.redirect).toBe("manual")
    expect(new Headers(calls[0].init.headers).get("user-agent")).toBe(
      OGP_USER_AGENT,
    )
  })

  it("リダイレクト先が内部向けなら取りに行かない", async () => {
    const calls: Call[] = []
    const record = await fetchOgpRecord("https://example.com/", {
      now,
      fetch: fakeFetch(
        {
          "https://example.com/": () =>
            redirect("http://169.254.169.254/latest/meta-data/", 302),
        },
        calls,
      ),
    })
    expect(record.data).toBeNull()
    expect(record.error).toContain("内部向け")
    expect(record.retryAfter).toBe(1_000_000 + OGP_RETRY_INTERVAL_MS)
    expect(calls).toHaveLength(1)
  })

  it("最初の URL が内部向けなら 1 度も取りに行かない", async () => {
    const calls: Call[] = []
    const record = await fetchOgpRecord("http://localhost:4321/", {
      now,
      fetch: fakeFetch({}, calls),
    })
    expect(record.data).toBeNull()
    expect(calls).toHaveLength(0)
  })

  it("リダイレクトは 5 回まで", async () => {
    const routes: Record<string, () => Response> = {}
    for (let i = 0; i < 10; i++) {
      routes[`https://example.com/${i}`] = () =>
        redirect(`https://example.com/${i + 1}`)
    }
    const calls: Call[] = []
    const record = await fetchOgpRecord("https://example.com/0", {
      now,
      fetch: fakeFetch(routes, calls),
    })
    expect(record.data).toBeNull()
    expect(record.error).toContain("リダイレクト")
    expect(calls).toHaveLength(6)
  })

  it("HTML でなければ URL だけのカード (失敗扱いにしない)", async () => {
    const record = await fetchOgpRecord("https://example.com/file.pdf", {
      now,
      fetch: fakeFetch({
        "https://example.com/file.pdf": () =>
          new Response("%PDF", {
            headers: { "content-type": "application/pdf" },
          }),
      }),
    })
    expect(record.error).toBeUndefined()
    expect(record.data).toEqual({
      url: "https://example.com/file.pdf",
      title: "https://example.com/file.pdf",
      domain: "example.com",
      favicon: "https://www.google.com/s2/favicons?domain=example.com&sz=64",
    })
  })

  it("HTTP エラーは失敗。1 日は再試行しない", async () => {
    const record = await fetchOgpRecord("https://example.com/404", {
      now,
      fetch: fakeFetch({
        "https://example.com/404": () =>
          new Response("not found", { status: 404 }),
      }),
    })
    expect(record).toEqual({
      url: "https://example.com/404",
      data: null,
      fetchedAt: 1_000_000,
      error: "HTTP 404",
      retryAfter: 1_000_000 + OGP_RETRY_INTERVAL_MS,
    })
  })

  it("タイムアウト", async () => {
    const record = await fetchOgpRecord("https://example.com/slow", {
      now,
      timeoutMs: 20,
      fetch: (_url, init) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          )
        }),
    })
    expect(record.data).toBeNull()
    expect(record.error).toBe("タイムアウトしました")
  })

  it("本文は上限で打ち切る。</head> まで読めたらそれ以上読まない", async () => {
    let pulled = 0
    const encoder = new TextEncoder()
    const chunks = [
      "<html><head><title>Big</title>",
      "</head><body>",
      ...Array(100).fill("x".repeat(1024)),
    ]
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        const chunk = chunks[pulled++]
        if (chunk === undefined) controller.close()
        else controller.enqueue(encoder.encode(chunk))
      },
    })
    const record = await fetchOgpRecord("https://example.com/big", {
      now,
      fetch: fakeFetch({
        "https://example.com/big": () =>
          new Response(stream, { headers: { "content-type": "text/html" } }),
      }),
    })
    expect(record.data?.title).toBe("Big")
    expect(pulled).toBeLessThan(10)

    let limited = 0
    const endless = new ReadableStream<Uint8Array>({
      pull(controller) {
        limited++
        controller.enqueue(encoder.encode("<p>".repeat(1000)))
      },
    })
    const truncated = await fetchOgpRecord("https://example.com/endless", {
      now,
      maxBytes: 10_000,
      fetch: fakeFetch({
        "https://example.com/endless": () =>
          new Response(endless, { headers: { "content-type": "text/html" } }),
      }),
    })
    expect(truncated.data?.title).toBe("https://example.com/endless")
    expect(limited).toBeLessThan(10)
  })
})

describe("shouldFetch", () => {
  const ok: OgpRecord = {
    url: "https://example.com/",
    data: legacyOgp("https://github.com/actions/runner/releases"),
    fetchedAt: 0,
  }
  const failed: OgpRecord = {
    url: "https://example.com/",
    data: null,
    fetchedAt: 0,
    error: "HTTP 500",
    retryAfter: 100,
  }
  it("無ければ取る。成功していれば取らない。失敗は再試行の時刻まで取らない", () => {
    expect(shouldFetch(null, 0)).toBe(true)
    expect(shouldFetch(ok, 1e15)).toBe(false)
    expect(shouldFetch(failed, 99)).toBe(false)
    expect(shouldFetch(failed, 100)).toBe(true)
  })
})

describe("createOgpResolver (公開ページ)", () => {
  const legacyUrl = "https://github.com/actions/runner/releases"
  const storedData = {
    url: "https://example.com/stored",
    title: "Stored",
    domain: "example.com",
  }

  it("ストレージ → JSON の順。どちらにも無い URL は入れない", async () => {
    const asked: string[][] = []
    const resolve = createOgpResolver(async (keys) => {
      asked.push(keys)
      return new Map([
        [
          "https://example.com/stored",
          { url: storedData.url, data: storedData, fetchedAt: 1 },
        ],
        [
          "https://example.com/failed",
          { url: "https://example.com/failed", data: null, fetchedAt: 1 },
        ],
      ])
    })
    const result = await resolve([
      "https://EXAMPLE.com/stored",
      legacyUrl,
      "https://example.com/failed",
      "https://example.com/unknown",
    ])
    expect(asked).toEqual([
      [
        "https://example.com/stored",
        legacyUrl,
        "https://example.com/failed",
        "https://example.com/unknown",
      ],
    ])
    expect(result.get("https://EXAMPLE.com/stored")).toEqual(storedData)
    expect(result.get(legacyUrl)?.title).toBe("Releases · actions/runner")
    expect(result.has("https://example.com/failed")).toBe(false)
    expect(result.has("https://example.com/unknown")).toBe(false)
  })

  it("ストレージに新しい値があればそちらを使う", async () => {
    const resolve = createOgpResolver(
      async () =>
        new Map([
          [
            legacyUrl,
            {
              url: legacyUrl,
              data: { url: legacyUrl, title: "New", domain: "github.com" },
              fetchedAt: 1,
            },
          ],
        ]),
    )
    expect((await resolve([legacyUrl])).get(legacyUrl)?.title).toBe("New")
  })

  it("ストレージを読めなければ JSON だけ", async () => {
    const resolve = createOgpResolver(async () => {
      throw new Error("no database")
    })
    const result = await resolve([legacyUrl, "https://example.com/x"])
    expect(result.get(legacyUrl)?.title).toBe("Releases · actions/runner")
    expect(result.size).toBe(1)
  })

  it("読み手が無ければ JSON だけ", async () => {
    const result = await createOgpResolver()([legacyUrl])
    expect(result.get(legacyUrl)?.title).toBe("Releases · actions/runner")
  })
})
