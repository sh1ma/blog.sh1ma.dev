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

type MediaItem = { id: string; url: string; filename?: string }

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

async function uploadDirect(file: File): Promise<MediaItem> {
  const form = new FormData()
  form.append("file", file)
  const { width, height } = await dimensions(file)
  if (width) form.append("width", String(width))
  if (height) form.append("height", String(height))
  const data = await readData<{ item: MediaItem }>(
    await apiFetch("/media", { method: "POST", body: form }),
    "画像のアップロード",
  )
  return data.item
}

/** 画像をアップロードし、本文に書く URL を返す */
export async function uploadImage(file: File): Promise<string> {
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
  if (response.status === 501) return (await uploadDirect(file)).url

  const info = await readData<UploadUrlResponse>(
    response,
    "アップロード先の取得",
  )
  if (info.existing) return info.url

  const headers = new Headers(info.headers)
  if (file.type) headers.set("Content-Type", file.type)
  const put = await fetch(info.uploadUrl, {
    method: info.method,
    headers,
    body: file,
    credentials: "same-origin",
  })
  if (!put.ok) {
    throw new Error(`画像のアップロードに失敗しました (${put.status})`)
  }

  const confirmed = await readData<{ item: MediaItem }>(
    await apiFetch(`/media/${encodeURIComponent(info.mediaId)}/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ size: file.size, ...(await dimensions(file)) }),
    }),
    "アップロードの確定",
  )
  return confirmed.item.url
}

/** ファイル名から alt の初期値を作る (拡張子を外す) */
export function altFromFilename(name: string): string {
  return name.replace(/\.[^.]+$/, "")
}
