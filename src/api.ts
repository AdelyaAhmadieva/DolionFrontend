/**
 * В dev (vite dev) по умолчанию пустая строка: запросы идут на тот же origin,
 * Vite проксирует `/api` → бэкенд (см. vite.config.ts). Так не ломается CORS
 * при открытии сайта как localhost или 127.0.0.1.
 * В production задайте VITE_API_URL на полный URL API.
 */
function apiBase(): string {
  const raw = import.meta.env.VITE_API_URL as string | undefined
  if (raw !== undefined && raw !== '') {
    return raw.replace(/\/$/, '')
  }
  if (import.meta.env.DEV) {
    return ''
  }
  return ''
}

export class ApiError extends Error {
  status: number
  body?: unknown

  constructor(message: string, status: number, body?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.body = body
  }
}

async function parseErrorBody(res: Response): Promise<unknown> {
  const text = await res.text()
  if (!text) return undefined
  try {
    return JSON.parse(text) as unknown
  } catch {
    return text
  }
}

export async function apiFetch<T>(
  path: string,
  init: RequestInit & { token?: string | null } = {},
): Promise<T> {
  const { token, headers: hdr, ...rest } = init
  const headers = new Headers(hdr)
  if (!headers.has('Content-Type') && rest.body) {
    headers.set('Content-Type', 'application/json')
  }
  if (token) {
    headers.set('Authorization', `Bearer ${token}`)
  }

  const res = await fetch(`${apiBase()}${path}`, {
    ...rest,
    headers,
  })

  if (!res.ok) {
    const body = await parseErrorBody(res)
    let msg = res.statusText
    if (body && typeof body === 'object' && 'error' in body) {
      const e = (body as { error?: string }).error
      if (e) msg = e
    }
    throw new ApiError(msg || 'Ошибка запроса', res.status, body)
  }

  const ct = res.headers.get('Content-Type') ?? ''
  if (ct.includes('application/json')) {
    return (await res.json()) as T
  }
  return undefined as T
}

export async function apiBlob(
  path: string,
  init: RequestInit & { token?: string | null } = {},
): Promise<Blob> {
  const { token, headers: hdr, ...rest } = init
  const headers = new Headers(hdr)
  headers.set('Content-Type', 'application/json')
  if (token) {
    headers.set('Authorization', `Bearer ${token}`)
  }
  const res = await fetch(`${apiBase()}${path}`, { ...rest, headers })
  if (!res.ok) {
    const body = await parseErrorBody(res)
    let msg = res.statusText
    if (body && typeof body === 'object' && 'error' in body) {
      const e = (body as { error?: string }).error
      if (e) msg = e
    }
    throw new ApiError(msg || 'Ошибка запроса', res.status, body)
  }
  return res.blob()
}

export type AuthResponse = {
  access_token: string
  token_type: string
  user: { id: string; email: string }
}

export type ParsePreviewResponse = {
  rows: Record<string, string>[]
  unmatched: {
    client_name: string
    quantity: string
    unit: string
    candidates: { name: string; unit: string; score: number }[]
  }[]
  needs_llm_confirmation?: boolean
  llm_confirmation_reason?: string
}

export type ParseHistoryItem = {
  parse_job_id: string
  status: 'parsed' | 'failed'
  source_preview: string
  rows_count: number
  last_export_at?: string
  last_export_file?: string
  created_at: string
}

export type ParseHistoryResponse = {
  items: ParseHistoryItem[]
}
