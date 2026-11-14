// 管理画面のセッションで EmDash のメディアに画像を上げる。
// @emdash-cms/admin の uploadMedia と同じ手順 (upload-url → PUT → confirm。
// 署名付き URL が使えないストレージでは /_emdash/api/media に直接 POST)。

const API = "/_emdash/api"

type ApiEnvelope<T> = {
  success?: boolean
  data?: T
  error?: { message?: string }
}

type UploadUrlResponse =
  | { existing: true; mediaId: string; url: string }
  | {
      existing?: undefined
      uploadUrl: string
      method: string
      headers: Record<string, string>
      mediaId: string
    }

export type UploadedMedia = { id: string; url: string; filename?: string }

export type UploadOptions = {
  /** 送信済みの割合 (0〜1)。XMLHttpRequest が無い環境では呼ばれない */
  onProgress?: (ratio: number) => void
}

function apiFetch(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers)
  // EmDash の API は CSRF 対策としてこのヘッダーを要求する
  headers.set("X-EmDash-Request", "1")
  return fetch(`${API}${path}`, {
    ...init,
    headers,
    credentials: "same-origin",
  })
}

async function readData<T>(response: Response, action: string): Promise<T> {
  const body = (await response.json().catch(() => ({}))) as ApiEnvelope<T>
  if (!response.ok || body.data === undefined) {
    throw new Error(
      `${action}に失敗しました (${response.status}${body.error?.message ? `: ${body.error.message}` : ""})`,
    )
  }
  return body.data
}

async function contentHash(file: File): Promise<string | undefined> {
  if (!globalThis.crypto?.subtle || file.size > 8 * 1024 * 1024) return
  const digest = await crypto.subtle.digest("SHA-1", await file.arrayBuffer())
  const hex = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("")
  return `sha1:${hex}`
}

async function dimensions(
  file: File,
): Promise<{ width?: number; height?: number }> {
  try {
    const bitmap = await createImageBitmap(file)
    const result = { width: bitmap.width, height: bitmap.height }
    bitmap.close()
    return result
  } catch {
    return {}
  }
}

/**
 * 進捗を取りたいので XMLHttpRequest で送る (fetch はアップロードの進捗を返さない)。
 * XMLHttpRequest が無い環境 (テストなど) では fetch にする。
 */
function send(
  url: string,
  init: {
    method: string
    headers: Headers
    body: Document | XMLHttpRequestBodyInit
  },
  onProgress?: (ratio: number) => void,
): Promise<Response> {
  if (typeof XMLHttpRequest === "undefined" || !onProgress) {
    return fetch(url, {
      method: init.method,
      headers: init.headers,
      body: init.body as BodyInit,
      credentials: "same-origin",
    })
  }
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open(init.method, url)
    // fetch の credentials: "same-origin" と同じ (同一オリジンなら Cookie は送られる。
    // 署名付き URL が別オリジンでも Cookie を付けない)
    xhr.withCredentials = false
    init.headers.forEach((value, key) => {
      xhr.setRequestHeader(key, value)
    })
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total)
    }
    xhr.onload = () => {
      onProgress(1)
      resolve(
        new Response(xhr.status === 204 ? null : xhr.responseText, {
          status: xhr.status,
          headers: {
            "Content-Type": xhr.getResponseHeader("Content-Type") ?? "",
          },
        }),
      )
    }
    xhr.onerror = () =>
      reject(new TypeError("アップロードの通信に失敗しました"))
    xhr.send(init.body)
  })
}

async function uploadDirect(
  file: File,
  options: UploadOptions,
): Promise<UploadedMedia> {
  const form = new FormData()
  form.append("file", file)
  const { width, height } = await dimensions(file)
  if (width) form.append("width", String(width))
  if (height) form.append("height", String(height))
  const headers = new Headers({ "X-EmDash-Request": "1" })
  const data = await readData<{ item: UploadedMedia }>(
    await send(
      `${API}/media`,
      { method: "POST", headers, body: form },
      options.onProgress,
    ),
    "画像のアップロード",
  )
  return data.item
}

/** ファイルを EmDash のメディアにアップロードし、メディアの項目を返す */
export async function uploadMedia(
  file: File,
  options: UploadOptions = {},
): Promise<UploadedMedia> {
  const response = await apiFetch("/media/upload-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      filename: file.name,
      contentType: file.type,
      size: file.size,
      contentHash: await contentHash(file),
    }),
  })
  if (response.status === 501) return uploadDirect(file, options)

  const info = await readData<UploadUrlResponse>(
    response,
    "アップロード先の取得",
  )
  if (info.existing) {
    options.onProgress?.(1)
    return { id: info.mediaId, url: info.url, filename: file.name }
  }

  const headers = new Headers(info.headers)
  if (file.type) headers.set("Content-Type", file.type)
  const put = await send(
    info.uploadUrl,
    { method: info.method, headers, body: file },
    options.onProgress,
  )
  if (!put.ok) {
    throw new Error(`画像のアップロードに失敗しました (${put.status})`)
  }

  const confirmed = await readData<{ item: UploadedMedia }>(
    await apiFetch(`/media/${encodeURIComponent(info.mediaId)}/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ size: file.size, ...(await dimensions(file)) }),
    }),
    "アップロードの確定",
  )
  return confirmed.item
}

/** 画像をアップロードし、本文に書く URL を返す */
export async function uploadImage(file: File): Promise<string> {
  return (await uploadMedia(file)).url
}

/** ファイル名から alt の初期値を作る (拡張子を外す) */
export function altFromFilename(name: string): string {
  return name.replace(/\.[^.]+$/, "")
}
