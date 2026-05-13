import { useCallback, useEffect, useMemo, useState } from 'react'
import mascotBee from '../Group 50.png'
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
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
type UnmatchedStatus = 'pending' | 'skipped' | 'added'
type InputMode = 'select' | 'manual'
type UnmatchedView = 'active' | 'skipped'
type UiUnmatchedItem = ParsePreviewResponse['unmatched'][number] & {
  id: string
  status: UnmatchedStatus
  inputMode: InputMode
}

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
  const [unmatched, setUnmatched] = useState<UiUnmatchedItem[]>([])
  const [needsLlmConfirm, setNeedsLlmConfirm] = useState(false)
  const [llmReason, setLlmReason] = useState('')
  const [picked, setPicked] = useState<Record<string, string>>({})
  const [customNames, setCustomNames] = useState<Record<string, string>>({})
  const [llmItemsCount, setLlmItemsCount] = useState<number | null>(null)
  const [unmatchedView, setUnmatchedView] = useState<UnmatchedView>('active')
  const [historyItems, setHistoryItems] = useState<ParseHistoryItem[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const columnKeys = useMemo(() => {
    if (rows.length === 0) return []
    return Object.keys(rows[0])
  }, [rows])
  const pendingUnmatched = useMemo(
    () => unmatched.filter((u) => u.status === 'pending'),
    [unmatched],
  )
  const skippedUnmatched = useMemo(
    () => unmatched.filter((u) => u.status === 'skipped'),
    [unmatched],
  )
  const canDownload = Boolean(
    message.trim() &&
      !busy &&
      !error &&
      !needsLlmConfirm &&
      pendingUnmatched.length === 0,
  )
  const previewButtonLabel = rows.length > 0 ? 'Пересоздать таблицу' : 'Создать таблицу'

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
    setCustomNames({})
    setLlmItemsCount(null)
    setUnmatchedView('active')
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
      setUnmatched(makeUiUnmatched(data.unmatched ?? []))
      setNeedsLlmConfirm(Boolean(data.needs_llm_confirmation))
      setLlmReason(data.llm_confirmation_reason ?? '')
      setPicked({})
      setCustomNames({})
      setLlmItemsCount(data.llm_items_count ?? null)
      setUnmatchedView('active')
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
      setUnmatched(makeUiUnmatched(data.unmatched ?? []))
      setNeedsLlmConfirm(false)
      setLlmReason('')
      setPicked({})
      setCustomNames({})
      setLlmItemsCount(data.llm_items_count ?? null)
      setUnmatchedView('active')
      await loadHistory(auth.token)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Ошибка LLM fallback')
    } finally {
      setBusy(false)
    }
  }

  const addSuggestionToRows = (id: string) => {
    const item = unmatched.find((u) => u.id === id)
    if (!item) return
    const customName = (customNames[id] ?? '').trim()
    const selectedName = picked[id] || item.candidates[0]?.name
    const selected = item.candidates.find((c) => c.name === selectedName)
    const finalName = item.inputMode === 'manual' ? customName : selected?.name || customName
    if (!finalName) return

    const nextRow: Record<string, string> = {
      'Клиентское название': item.client_name,
      'Номенклатура': finalName,
      'Количество': item.quantity,
      'Ед. изм.': item.unit || selected?.unit || 'шт',
      'Уверенность': item.inputMode === 'manual'
        ? 'Ручной ввод'
        : `${Math.round((selected?.score ?? 0) * 100)}%`,
    }
    setRows((prev) => [...prev, nextRow])
    setUnmatched((prev) =>
      prev.map((u) => (u.id === id ? { ...u, status: 'added' } : u)),
    )
    setPicked((prev) => {
      const copy = { ...prev }
      delete copy[id]
      return copy
    })
    setCustomNames((prev) => {
      const copy = { ...prev }
      delete copy[id]
      return copy
    })
  }

  const skipUnmatched = (id: string) => {
    setUnmatched((prev) =>
      prev.map((u) => (u.id === id ? { ...u, status: 'skipped' } : u)),
    )
  }

  const restoreUnmatched = (id: string) => {
    setUnmatched((prev) =>
      prev.map((u) => (u.id === id ? { ...u, status: 'pending' } : u)),
    )
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
      <div className="min-h-svh bg-fixed bg-gradient-to-br from-white via-amber-50 to-yellow-200">
        <div className="mx-auto flex min-h-svh max-w-md flex-col justify-center gap-6 px-4 py-10">
          <div className="space-y-1 text-center">
            <img
              src={mascotBee}
              alt="Momblebee mascot"
              className="mx-auto mb-3 h-20 w-auto drop-shadow-md"
            />
            <h1 className="font-heading text-2xl font-semibold tracking-tight text-black">
              <span className="text-yellow-600">Mom</span>blebee
            </h1>
            <p className="text-muted-foreground text-sm">Привет, мам!</p>
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
              <CardContent className="space-y-4 pb-2">
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
    <div className="min-h-svh bg-fixed bg-gradient-to-br from-white via-amber-50 to-yellow-200">
      <header className="border-border bg-card/50 sticky top-0 z-10 border-b backdrop-blur">
        <div className="mx-auto flex w-full max-w-[1280px] items-center justify-between gap-4 px-4 py-3">
          <div className="flex items-center gap-3">
            <img
              src={mascotBee}
              alt="Momblebee mascot"
              className="h-10 w-auto shrink-0 drop-shadow-sm"
            />
            <div>
              <p className="font-heading text-base font-semibold text-black">
                <span className="text-yellow-600">Mom</span>blebee
              </p>
              <p className="text-muted-foreground text-xs">Привет, мам!</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <p className="text-muted-foreground text-xs">{auth.email}</p>
            <Button type="button" variant="outline" size="sm" onClick={logout}>
              <LogOut />
              Выйти
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1280px] space-y-6 px-4 py-8">
        {error ? (
          <Alert variant="destructive">
            <AlertTitle>Ошибка</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        <div className="grid gap-6 lg:grid-cols-12">
          <div className="lg:col-span-7">
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
                    {previewButtonLabel}
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={downloadXlsx}
                    disabled={!canDownload}
                  >
                    <FileSpreadsheet />
                    Скачать Excel
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="lg:col-span-5">
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
                  {llmItemsCount !== null ? (
                    <p className="text-muted-foreground text-sm">
                      Нейронка вернула позиций: {llmItemsCount}
                    </p>
                  ) : null}
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
            ) : unmatched.some((u) => u.status !== 'added') ? (
              <Card className="max-h-[560px]">
                <CardHeader>
                  <CardTitle>Нужен выбор сотрудника</CardTitle>
                  <CardDescription>
                    Эти позиции не найдены в смете автоматически. Заполните вручную или выберите близкий вариант.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4 overflow-y-auto">
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant={unmatchedView === 'active' ? 'default' : 'outline'}
                      onClick={() => setUnmatchedView('active')}
                    >
                      В работе ({pendingUnmatched.length})
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant={unmatchedView === 'skipped' ? 'default' : 'outline'}
                      onClick={() => setUnmatchedView('skipped')}
                    >
                      Пропущенные ({skippedUnmatched.length})
                    </Button>
                  </div>
                  <div className="rounded-md border border-amber-200/70 bg-amber-50/70 p-3 text-sm">
                    <p className="font-medium text-amber-900">Позиции требуют подтверждения сотрудником</p>
                    <p className="mt-1 text-amber-800">
                      Ничего не попадет в итоговую таблицу, пока вы не нажмете «Добавить в таблицу» для каждой позиции.
                    </p>
                  </div>
                  {(unmatchedView === 'active' ? pendingUnmatched : skippedUnmatched).length === 0 ? (
                    <p className="text-muted-foreground text-sm">
                      {unmatchedView === 'active'
                        ? 'Нет карточек в работе.'
                        : 'Нет пропущенных карточек.'}
                    </p>
                  ) : null}
                  {(unmatchedView === 'active' ? pendingUnmatched : skippedUnmatched).map((item) => (
                    <div
                      key={item.id}
                      className={`border-border rounded-md border p-3 space-y-2 transition-opacity ${
                        item.status === 'skipped' ? 'opacity-45' : 'opacity-100'
                      }`}
                    >
                      <p className="text-sm font-medium">
                        {item.client_name} · {item.quantity} {item.unit || 'шт'}
                      </p>
                      <div className="space-y-2">
                        <div className="flex flex-wrap gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant={item.inputMode === 'select' ? 'default' : 'outline'}
                            onClick={() =>
                              setUnmatched((prev) =>
                                prev.map((u) =>
                                  u.id === item.id ? { ...u, inputMode: 'select' } : u,
                                ),
                              )
                            }
                            disabled={item.status === 'skipped'}
                          >
                            Вариант из сметы
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant={item.inputMode === 'manual' ? 'default' : 'outline'}
                            onClick={() =>
                              setUnmatched((prev) =>
                                prev.map((u) =>
                                  u.id === item.id ? { ...u, inputMode: 'manual' } : u,
                                ),
                              )
                            }
                            disabled={item.status === 'skipped'}
                          >
                            Ручной ввод
                          </Button>
                        </div>
                        {item.inputMode === 'select' && item.candidates.length > 0 ? (
                          <Select
                            value={picked[item.id] ?? item.candidates[0]?.name ?? ''}
                            onValueChange={(value) =>
                              setPicked((prev) => ({ ...prev, [item.id]: value }))
                            }
                          >
                            <SelectTrigger className="w-full">
                              <SelectValue placeholder="Выберите вариант из сметы" />
                            </SelectTrigger>
                            <SelectContent>
                              {item.candidates.map((c) => (
                                <SelectItem key={c.name} value={c.name}>
                                  {c.name} ({Math.round(c.score * 100)}%)
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : item.inputMode === 'select' ? (
                          <p className="text-muted-foreground text-xs">
                            Подходящие варианты в смете не найдены — заполните вручную.
                          </p>
                        ) : null}
                        {item.inputMode === 'manual' ? (
                          <Input
                            placeholder="Впишите свое название для таблицы"
                            value={customNames[item.id] ?? ''}
                            disabled={item.status === 'skipped'}
                            onChange={(ev) =>
                              setCustomNames((prev) => ({ ...prev, [item.id]: ev.target.value }))
                            }
                          />
                        ) : null}
                        <p className="text-muted-foreground text-xs">
                          Текущий режим: {item.inputMode === 'select' ? 'выбор из сметы' : 'ручной ввод'}
                        </p>
                      </div>
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                        <Button
                          type="button"
                          size="sm"
                          className="w-full sm:w-auto"
                          disabled={unmatchedView === 'skipped'}
                          onClick={() => addSuggestionToRows(item.id)}
                        >
                          Добавить в таблицу
                        </Button>
                        {item.status === 'skipped' ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="w-full sm:w-auto"
                            onClick={() => restoreUnmatched(item.id)}
                          >
                            Вернуть в работу
                          </Button>
                        ) : (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="w-full sm:w-auto"
                            onClick={() => skipUnmatched(item.id)}
                          >
                            Пропустить
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            ) : null}
          </div>
        </div>

        {rows.length > 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>Данные</CardTitle>
              <CardDescription>
                Это не то, что будет в таблице, а удобные данные для тебя
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

        <div className="mt-2 border-t border-border/70 pt-8 lg:mt-6 lg:pt-10">
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
        </div>
      </main>
    </div>
  )
}

function makeUiUnmatched(items: ParsePreviewResponse['unmatched']): UiUnmatchedItem[] {
  return items.map((item, idx) => ({
    ...item,
    id: `${item.client_name}-${item.quantity}-${idx}-${Date.now()}`,
    status: 'pending',
    inputMode: item.candidates.length > 0 ? 'select' : 'manual',
  }))
}
