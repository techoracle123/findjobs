import { useCallback, useEffect, useRef, useState } from 'react'
import type { AlertPreference, Profile, SavedApplication } from '../shared/types'
import { readLocal, writeLocal } from '../lib/storage'
import {
  ApiError,
  deleteAlert,
  deleteSaved,
  fetchAccount,
  importAccount,
  patchAlert,
  postAlert,
  postSaved,
  putProfile,
  type AccountSnapshot,
  type AccountUser,
  type ImportResult,
  type Subscription,
} from '../lib/api'

export type AccountMode = 'loading' | 'anonymous' | 'signed-in'

/** Accepts either a value or an updater, like a React state setter. */
export type Setter<T> = (value: T | ((current: T) => T)) => void

const EMPTY_PROFILE: Profile = {
  skills: [],
  targetRoleFamilies: [],
  targetSeniority: [],
  preferredWorkModes: [],
  workCountry: '',
}

export interface UseAccount {
  mode: AccountMode
  user: AccountUser | null
  subscription: Subscription | null
  entitlements: string[]
  profile: Profile
  saved: SavedApplication[]
  alerts: AlertPreference[]
  setProfile: Setter<Profile>
  setSaved: Setter<SavedApplication[]>
  setAlerts: Setter<AlertPreference[]>
  refresh: () => Promise<void>
  importLocalData: () => Promise<ImportResult>
  syncError: string | null
}

/**
 * Owns the account-scoped state.
 *
 * The browser keeps a copy of everything so the interface is instant and
 * works with no account at all. When an account is present the server is the
 * source of truth and every change is written through to it.
 */
export function useAccount(): UseAccount {
  const [mode, setMode] = useState<AccountMode>('loading')
  const [user, setUser] = useState<AccountUser | null>(null)
  const [subscription, setSubscription] = useState<Subscription | null>(null)
  const [entitlements, setEntitlements] = useState<string[]>([])
  const [profile, setProfileState] = useState<Profile>(() =>
    readLocal<Profile>('profile', EMPTY_PROFILE),
  )
  const [saved, setSavedState] = useState<SavedApplication[]>(() =>
    readLocal<SavedApplication[]>('saved', []),
  )
  const [alerts, setAlertsState] = useState<AlertPreference[]>(() =>
    readLocal<AlertPreference[]>('alerts', []),
  )
  const [syncError, setSyncError] = useState<string | null>(null)

  const signedIn = mode === 'signed-in'
  const profileTimer = useRef<number | null>(null)

  // The latest values, so a setter can diff against them when it is given
  // an updater function.
  const profileRef = useRef(profile)
  const savedRef = useRef(saved)
  const alertsRef = useRef(alerts)
  profileRef.current = profile
  savedRef.current = saved
  alertsRef.current = alerts

  const applySnapshot = useCallback((snapshot: AccountSnapshot) => {
    setUser(snapshot.user)
    setSubscription(snapshot.subscription)
    setEntitlements(snapshot.entitlements)
    setProfileState(snapshot.profile)
    setSavedState(snapshot.saved)
    setAlertsState(snapshot.alerts)
    writeLocal('profile', snapshot.profile)
    writeLocal('saved', snapshot.saved)
    writeLocal('alerts', snapshot.alerts)
  }, [])

  const refresh = useCallback(async () => {
    try {
      const snapshot = await fetchAccount()
      applySnapshot(snapshot)
      setMode('signed-in')
      setSyncError(null)
    } catch (error) {
      setMode('anonymous')
      if (!(error instanceof ApiError && error.status === 401)) {
        setSyncError(error instanceof Error ? error.message : String(error))
      }
    }
  }, [applySnapshot])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const setProfile = useCallback<Setter<Profile>>(
    (value) => {
      const next = typeof value === 'function' ? value(profileRef.current) : value
      profileRef.current = next
      setProfileState(next)
      writeLocal('profile', next)
      if (!signedIn) return

      // Profile edits arrive one keystroke at a time, so they are coalesced.
      if (profileTimer.current !== null) window.clearTimeout(profileTimer.current)
      profileTimer.current = window.setTimeout(() => {
        void putProfile(next).catch((error: unknown) => {
          setSyncError(error instanceof Error ? error.message : String(error))
        })
      }, 600)
    },
    [signedIn],
  )

  const setSaved = useCallback<Setter<SavedApplication[]>>(
    (value) => {
      const previous = savedRef.current
      const next = typeof value === 'function' ? value(previous) : value
      savedRef.current = next
      setSavedState(next)
      writeLocal('saved', next)
      if (!signedIn) return

      for (const entry of next) {
        const before = previous.find((item) => item.jobId === entry.jobId)
        if (!before || before.status !== entry.status) {
          void postSaved(entry.jobId, entry.status).catch((error: unknown) => {
            setSyncError(error instanceof Error ? error.message : String(error))
          })
        }
      }
      for (const entry of previous) {
        if (!next.some((item) => item.jobId === entry.jobId)) {
          void deleteSaved(entry.jobId).catch((error: unknown) => {
            setSyncError(error instanceof Error ? error.message : String(error))
          })
        }
      }
    },
    [signedIn],
  )

  const setAlerts = useCallback<Setter<AlertPreference[]>>(
    (value) => {
      const previous = alertsRef.current
      const next = typeof value === 'function' ? value(previous) : value
      alertsRef.current = next
      setAlertsState(next)
      writeLocal('alerts', next)
      if (!signedIn) return

      for (const entry of next) {
        const before = previous.find((item) => item.id === entry.id)
        if (!before) {
          void postAlert(entry).catch((error: unknown) => {
            setSyncError(error instanceof Error ? error.message : String(error))
          })
        } else if (
          before.label !== entry.label ||
          before.query !== entry.query ||
          before.enabled !== entry.enabled
        ) {
          void patchAlert(entry.id, entry).catch((error: unknown) => {
            setSyncError(error instanceof Error ? error.message : String(error))
          })
        }
      }
      for (const entry of previous) {
        if (!next.some((item) => item.id === entry.id)) {
          void deleteAlert(entry.id).catch((error: unknown) => {
            setSyncError(error instanceof Error ? error.message : String(error))
          })
        }
      }
    },
    [signedIn],
  )

  const importLocalData = useCallback(async () => {
    const result = await importAccount({
      profile: readLocal<Profile>('profile', EMPTY_PROFILE),
      saved: readLocal<SavedApplication[]>('saved', []),
      alerts: readLocal<AlertPreference[]>('alerts', []),
    })
    await refresh()
    return result
  }, [refresh])

  return {
    mode,
    user,
    subscription,
    entitlements,
    profile,
    saved,
    alerts,
    setProfile,
    setSaved,
    setAlerts,
    refresh,
    importLocalData,
    syncError,
  }
}
