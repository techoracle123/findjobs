const PREFIX = 'rolesignal:'

/**
 * Profile, saved jobs, applications and alert preferences live in this
 * browser only. There is no account system in the preview, so nothing here
 * reaches the server.
 */
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
    // Storage can be full or blocked; the preview still works in-memory.
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
