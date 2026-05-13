import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ApiError,
  apiBlob,
  apiFetch,
  type AuthResponse,
  type ParseHistoryItem,
  type ParseHistoryResponse,
  type ParsePreviewResponse,
} from '@/api'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { FileSpreadsheet, Loader2, LogOut } from 'lucide-react'

const TOKEN_KEY = 'dolionhelper_token'
const USER_KEY = 'dolionhelper_user'

function loadStoredAuth(): { token: string; email: string } | null {
  const token = localStorage.getItem(TOKEN_KEY)
  const email = localStorage.getItem(USER_KEY)
  if (token && email) return { token, email }
  return null
}

export default function App() {
  const [auth, setAuth] = useState<{ token: string; email: string } | null>(
    () => loadStoredAuth(),
  )
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [message, setMessage] = useState('')
  const [rows, setRows] = useState<Record<string, string>[]>([])
  const [unmatched, setUnmatched] = useState<ParsePreviewResponse['unmatched']>([])
  const [needsLlmConfirm, setNeedsLlmConfirm] = useState(false)
  const [llmReason, setLlmReason] = useState('')
  const [picked, setPicked] = useState<Record<number, string>>({})
  const [historyItems, setHistoryItems] = useState<ParseHistoryItem[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const columnKeys = useMemo(() => {
    if (rows.length === 0) return []
    return Object.keys(rows[0])
  }, [rows])

  const clearError = useCallback(() => setError(null), [])

  const loadHistory = useCallback(async (token: string) => {
    const data = await apiFetch<ParseHistoryResponse>('/api/v1/parse/history', {
      method: 'GET',
      token,
    })
    setHistoryItems(data.items ?? [])
  }, [])

  useEffect(() => {
    if (!auth) return
    void loadHistory(auth.token).catch(() => {
      setHistoryItems([])
    })
  }, [auth, loadHistory])

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault()
    clearError()
    setBusy(true)
    try {
      const path =
        authMode === 'login' ? '/api/v1/auth/login' : '/api/v1/auth/register'
      const data = await apiFetch<AuthResponse>(path, {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      })
      localStorage.setItem(TOKEN_KEY, data.access_token)
      localStorage.setItem(USER_KEY, data.user.email)
      setAuth({ token: data.access_token, email: data.user.email })
      await loadHistory(data.access_token)
      setPassword('')
    } catch (err) {
      const fallback =
        authMode === 'login'
          ? 'Не удалось войти'
          : 'Не удалось зарегистрироваться'
      if (err instanceof ApiError) {
        setError(err.message)
      } else if (err instanceof Error && err.message) {
        setError(`${fallback}. ${err.message}`)
      } else {
        setError(fallback)
      }
    } finally {
      setBusy(false)
    }
  }

  const logout = () => {
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(USER_KEY)
    setAuth(null)
    setRows([])
    setUnmatched([])
    setNeedsLlmConfirm(false)
    setLlmReason('')
    setPicked({})
    setHistoryItems([])
    setMessage('')
  }

  const preview = async () => {
    if (!auth) return
    clearError()
    setNeedsLlmConfirm(false)
    setLlmReason('')
    setBusy(true)
    try {
      const data = await apiFetch<ParsePreviewResponse>('/api/v1/parse/message', {
        method: 'POST',
        token: auth.token,
        body: JSON.stringify({ message }),
      })
      setRows(data.rows ?? [])
      setUnmatched(data.unmatched ?? [])
      setNeedsLlmConfirm(Boolean(data.needs_llm_confirmation))
      setLlmReason(data.llm_confirmation_reason ?? '')
      setPicked({})
      if (data.needs_llm_confirmation) {
        setError(null)
      }
      await loadHistory(auth.token)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Ошибка разбора')
    } finally {
      setBusy(false)
    }
  }

  const runLlmFallback = async () => {
    if (!auth) return
    clearError()
    setBusy(true)
    try {
      const data = await apiFetch<ParsePreviewResponse>(
        '/api/v1/parse/message/llm-fallback',
        {
          method: 'POST',
          token: auth.token,
          body: JSON.stringify({
            message,
            confirm_external_llm: true,
          }),
        },
      )
      setRows(data.rows ?? [])
      setUnmatched(data.unmatched ?? [])
      setNeedsLlmConfirm(false)
      setLlmReason('')
      setPicked({})
      await loadHistory(auth.token)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Ошибка LLM fallback')
    } finally {
      setBusy(false)
    }
  }

  const addSuggestionToRows = (idx: number) => {
    const item = unmatched[idx]
    if (!item) return
    const selectedName = picked[idx] || item.candidates[0]?.name
    if (!selectedName) return
    const selected = item.candidates.find((c) => c.name === selectedName)
    if (!selected) return

    const nextRow: Record<string, string> = {
      'Клиентское название': item.client_name,
      'Номенклатура': selected.name,
      'Количество': item.quantity,
      'Ед. изм.': item.unit || selected.unit || 'шт',
      'Уверенность': `${Math.round(selected.score * 100)}%`,
    }
    setRows((prev) => [...prev, nextRow])
    setUnmatched((prev) => prev.filter((_, i) => i !== idx))
    setPicked((prev) => {
      const copy = { ...prev }
      delete copy[idx]
      return copy
    })
  }

  const downloadXlsx = async () => {
    if (!auth) return
    clearError()
    setBusy(true)
    try {
      const hasPreviewRows = rows.length > 0
      const blob = await apiBlob(
        hasPreviewRows ? '/api/v1/parse/export/rows' : '/api/v1/parse/export',
        {
          method: 'POST',
          token: auth.token,
          body: JSON.stringify(hasPreviewRows ? { rows } : { message }),
        },
      )
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'dolion-helper.xlsx'
      a.click()
      URL.revokeObjectURL(url)
      await loadHistory(auth.token)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не удалось скачать файл')
    } finally {
      setBusy(false)
    }
  }

  const exportFromHistory = async (jobId: string) => {
    if (!auth) return
    clearError()
    setBusy(true)
    try {
      const blob = await apiBlob(`/api/v1/parse/history/${jobId}/export`, {
        method: 'POST',
        token: auth.token,
      })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = 'dolion-helper-history.xlsx'
      a.click()
      URL.revokeObjectURL(url)
      await loadHistory(auth.token)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не удалось скачать файл из истории')
    } finally {
      setBusy(false)
    }
  }

  if (!auth) {
    return (
      <div className="bg-background min-h-svh">
        <div className="mx-auto flex min-h-svh max-w-md flex-col justify-center gap-6 px-4 py-10">
          <div className="space-y-1 text-center">
            <h1 className="font-heading text-foreground text-2xl font-semibold tracking-tight">
              DolionHelper
            </h1>
            <p className="text-muted-foreground text-sm">
              Сообщение → таблица для Долион
            </p>
          </div>

          <Card>
            <CardHeader>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant={authMode === 'login' ? 'default' : 'outline'}
                  size="sm"
                  className="flex-1"
                  onClick={() => {
                    setAuthMode('login')
                    clearError()
                  }}
                >
                  Вход
                </Button>
                <Button
                  type="button"
                  variant={authMode === 'register' ? 'default' : 'outline'}
                  size="sm"
                  className="flex-1"
                  onClick={() => {
                    setAuthMode('register')
                    clearError()
                  }}
                >
                  Регистрация
                </Button>
              </div>
              <CardTitle className="sr-only">
                {authMode === 'login' ? 'Вход' : 'Регистрация'}
              </CardTitle>
              <CardDescription>
                {authMode === 'login'
                  ? 'Войдите по email и паролю'
                  : 'Создайте аккаунт для доступа к разбору'}
              </CardDescription>
            </CardHeader>
            <form onSubmit={handleAuth}>
              <CardContent className="space-y-4">
                {error ? (
                  <Alert variant="destructive">
                    <AlertTitle>Ошибка</AlertTitle>
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                ) : null}
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(ev) => setEmail(ev.target.value)}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password">Пароль</Label>
                  <Input
                    id="password"
                    type="password"
                    autoComplete={
                      authMode === 'login' ? 'current-password' : 'new-password'
                    }
                    value={password}
                    onChange={(ev) => setPassword(ev.target.value)}
                    required
                    minLength={8}
                  />
                </div>
              </CardContent>
              <CardFooter className="flex flex-col gap-3">
                <Button type="submit" className="w-full" disabled={busy}>
                  {busy ? (
                    <>
                      <Loader2 className="animate-spin" />
                      Подождите…
                    </>
                  ) : authMode === 'login' ? (
                    'Войти'
                  ) : (
                    'Зарегистрироваться'
                  )}
                </Button>
              </CardFooter>
            </form>
          </Card>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-background min-h-svh">
      <header className="border-border bg-card/50 sticky top-0 z-10 border-b backdrop-blur">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-4 px-4 py-3">
          <div>
            <p className="font-heading text-foreground text-base font-semibold">
              DolionHelper
            </p>
            <p className="text-muted-foreground text-xs">{auth.email}</p>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={logout}>
            <LogOut />
            Выйти
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-4xl space-y-6 px-4 py-8">
        {error ? (
          <Alert variant="destructive">
            <AlertTitle>Ошибка</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>Сообщение</CardTitle>
            <CardDescription>
              Вставьте текст. Превью и Excel используют один и тот же текст.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Textarea
              placeholder="Текст сообщения…"
              value={message}
              onChange={(ev) => setMessage(ev.target.value)}
              className="min-h-[160px] resize-y"
            />
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                onClick={preview}
                disabled={busy || !message.trim()}
              >
                {busy ? <Loader2 className="animate-spin" /> : null}
                Превью таблицы
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={downloadXlsx}
                disabled={busy || !message.trim()}
              >
                <FileSpreadsheet />
                Скачать Excel
              </Button>
            </div>
          </CardContent>
        </Card>

        {needsLlmConfirm ? (
          <Card>
            <CardHeader>
              <CardTitle>Нужна помощь DeepSeek</CardTitle>
              <CardDescription>
                Сообщение не удалось полностью разобрать rule-based алгоритмом. Можно отправить текст во внешний API DeepSeek только после вашего подтверждения.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-muted-foreground text-sm">
                Причина: {llmReason || 'сложная структура сообщения'}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button type="button" onClick={runLlmFallback} disabled={busy}>
                  {busy ? <Loader2 className="animate-spin" /> : null}
                  Разрешить и продолжить
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => {
                    setNeedsLlmConfirm(false)
                    setLlmReason('')
                  }}
                >
                  Отмена
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : null}

        {rows.length > 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>Превью</CardTitle>
              <CardDescription>
                Колонки пока задаются заглушкой на бэкенде; после согласования
                формата Dolion они станут финальными.
              </CardDescription>
            </CardHeader>
            <CardContent className="overflow-x-auto px-0 sm:px-4">
              <Table>
                <TableHeader>
                  <TableRow>
                    {columnKeys.map((k) => (
                      <TableHead key={k}>{k}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row, i) => (
                    <TableRow key={i}>
                      {columnKeys.map((k) => (
                        <TableCell key={k} className="max-w-[280px] truncate">
                          {row[k] ?? ''}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        ) : null}

        {unmatched.length > 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>Нужен выбор сотрудника</CardTitle>
              <CardDescription>
                Для этих позиций не найдено точное совпадение. Выберите вариант из сметы и добавьте в таблицу.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {unmatched.map((item, idx) => (
                <div key={`${item.client_name}-${idx}`} className="border-border rounded-md border p-3 space-y-2">
                  <p className="text-sm font-medium">
                    {item.client_name} · {item.quantity} {item.unit || 'шт'}
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      className="border-border bg-background min-w-[320px] rounded-md border px-2 py-1 text-sm"
                      value={picked[idx] ?? item.candidates[0]?.name ?? ''}
                      onChange={(ev) =>
                        setPicked((prev) => ({ ...prev, [idx]: ev.target.value }))
                      }
                    >
                      {item.candidates.map((c) => (
                        <option key={c.name} value={c.name}>
                          {c.name} ({Math.round(c.score * 100)}%)
                        </option>
                      ))}
                    </select>
                    <Button type="button" size="sm" onClick={() => addSuggestionToRows(idx)}>
                      Добавить в таблицу
                    </Button>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>История операций</CardTitle>
            <CardDescription>
              Последние разборы и экспорты текущего пользователя.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {historyItems.length === 0 ? (
              <p className="text-muted-foreground text-sm">Пока нет сохраненных операций.</p>
            ) : (
              historyItems.map((item) => (
                <div
                  key={item.parse_job_id}
                  className="border-border flex flex-wrap items-center justify-between gap-2 rounded-md border p-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{item.source_preview || 'Без превью текста'}</p>
                    <p className="text-muted-foreground text-xs">
                      Статус: {item.status} · Строк: {item.rows_count} ·{' '}
                      {new Date(item.created_at).toLocaleString()}
                    </p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={busy || item.status !== 'parsed'}
                    onClick={() => void exportFromHistory(item.parse_job_id)}
                  >
                    Повторный Excel
                  </Button>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  )
}
