/**
 * API-token plumbing for the dashboard.
 *
 * The daemon optionally enforces auth via an `X-Nebo-Token` header on
 * HTTP and a `?token=…` query param on the WebSocket. Browsers can't
 * set custom headers on WS handshakes, so we accept the token from the
 * URL once, persist it in localStorage, and apply it from there on
 * every subsequent request.
 */

const STORAGE_KEY = 'nebo.api_token'

let cached: string | null = null

function readUrlToken(): string | null {
  if (typeof window === 'undefined') return null
  const params = new URLSearchParams(window.location.search)
  return params.get('token')
}

function persist(token: string): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, token)
  } catch {
    // localStorage can be denied (private browsing, embedded sandbox);
    // we still keep the in-memory copy for the lifetime of the page.
  }
}

function readPersisted(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

/**
 * Resolve the token in priority order: in-memory cache, URL query
 * (which we then persist + strip from the visible URL), localStorage.
 *
 * The URL strip uses replaceState so back/forward history doesn't
 * keep the token in plaintext URLs, but it's a soft measure — the
 * token has already been transmitted by the time JS runs.
 */
export function getAuthToken(): string | null {
  if (cached) return cached

  const fromUrl = readUrlToken()
  if (fromUrl) {
    cached = fromUrl
    persist(fromUrl)
    try {
      const url = new URL(window.location.href)
      url.searchParams.delete('token')
      const cleaned = url.pathname + (url.search ? `?${url.searchParams.toString()}` : '') + url.hash
      window.history.replaceState({}, '', cleaned)
    } catch {
      // Ignore — soft scrubbing only.
    }
    return cached
  }

  const fromStorage = readPersisted()
  if (fromStorage) {
    cached = fromStorage
    return cached
  }

  return null
}

/** Manually set / overwrite the token (used by the prompt UI on 401). */
export function setAuthToken(token: string): void {
  cached = token
  persist(token)
}

/** Forget the token — used after a 401 to force a re-prompt. */
export function clearAuthToken(): void {
  cached = null
  try {
    window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    // ignore
  }
}

/** Headers spread for fetch options. Empty object when no token. */
export function authHeaders(): Record<string, string> {
  const t = getAuthToken()
  return t ? { 'X-Nebo-Token': t } : {}
}

// ── Unauthorized signal ──────────────────────────────────────────────
// HTTP 401 (and the WS 403 that follows from missing auth) need to flip
// the dashboard from "Reconnecting…" into a token-entry prompt. We use
// a tiny external store so any module — fetch helpers, WS manager —
// can flag the auth failure, and React can subscribe via
// `useSyncExternalStore`.

let unauthorized = false
const listeners = new Set<() => void>()

export function setUnauthorized(value: boolean): void {
  if (unauthorized === value) return
  unauthorized = value
  listeners.forEach(l => l())
}

export function getUnauthorized(): boolean {
  return unauthorized
}

export function subscribeUnauthorized(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
