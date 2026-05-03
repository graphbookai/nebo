import { useState } from 'react'
import { setAuthToken } from '@/lib/auth'

/**
 * Shown when the daemon answers 401 to a UI request — i.e. the
 * dashboard requires a token and we don't have one (or have a stale
 * one). Submitting persists the token via the auth helper and reloads
 * the page so the WebSocket reconnects with the new token in its
 * handshake URL.
 */
export function TokenPrompt() {
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = value.trim()
    if (!trimmed) return
    setBusy(true)
    setAuthToken(trimmed)
    // Reload so the WebSocket reconnects with the token applied to
    // its handshake URL — there's no public reconnect API on the
    // singleton manager and full reload is the safest reset.
    window.location.reload()
  }

  return (
    <div className="h-screen flex items-center justify-center bg-background text-foreground">
      <form
        onSubmit={submit}
        className="w-full max-w-sm rounded-lg border border-border bg-card p-6 space-y-4"
      >
        <div className="space-y-1">
          <h1 className="text-lg font-semibold">Sign in</h1>
          <p className="text-sm text-muted-foreground">
            This dashboard is protected. Paste the API token shared by the
            owner, or append <code className="text-xs bg-muted px-1 rounded">?token=…</code>{' '}
            to the URL.
          </p>
        </div>
        <input
          type="password"
          autoFocus
          autoComplete="off"
          spellCheck={false}
          value={value}
          onChange={e => setValue(e.target.value)}
          placeholder="nb_…"
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-ring"
        />
        <button
          type="submit"
          disabled={busy || !value.trim()}
          className="w-full rounded-md bg-primary text-primary-foreground px-3 py-2 text-sm font-medium hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {busy ? 'Signing in…' : 'Continue'}
        </button>
      </form>
    </div>
  )
}
