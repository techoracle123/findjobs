const PREFIX = 'rolesignal:'

/** Device preferences and namespaced caches only; verified account data is
 * authoritative on the server. Never reuse a signed-in cache for an anonymous
 * visitor or another user. Storage may be unavailable in private browsers. */
export function readLocal<T>(key: string, fallback: T): T {
  if (typeof localStorage === 'undefined') return fallback
  try {
    const raw = localStorage.getItem(PREFIX + key)
    if (raw === null) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

export function writeLocal<T>(key: string, value: T): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value))
  } catch {
    // Storage can be full or blocked; the interface still works in-memory.
  }
}

export function removeLocal(key: string): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.removeItem(PREFIX + key)
  } catch {
    // Ignore: nothing depends on removal succeeding.
  }
}
