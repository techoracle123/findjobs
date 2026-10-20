import { useCallback, useEffect, useRef, useState } from 'react'
import type { ApplicationActivity } from '../shared/activity'
import type { AlertPreference, Profile, SavedApplication } from '../shared/types'
import { readLocal, writeLocal } from '../lib/storage'
import {
  ApiError,
  deleteAlert,
  deleteSaved,
  fetchAccount,
  fetchApplicationActivity,
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
  hasLocalData: boolean
  activity: ApplicationActivity | null
  activityError: boolean
}

function readAnonymous<T>(key: string, fallback: T): T {
  return readLocal<string | null>('account-owner', null) ? fallback : readLocal<T>(key, fallback)
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
    readAnonymous<Profile>('profile', EMPTY_PROFILE),
  )
  const [saved, setSavedState] = useState<SavedApplication[]>(() =>
    readAnonymous<SavedApplication[]>('saved', []),
  )
  const [alerts, setAlertsState] = useState<AlertPreference[]>(() =>
    readAnonymous<AlertPreference[]>('alerts', []),
  )
  const [syncError, setSyncError] = useState<string | null>(null)
  const [activity, setActivity] = useState<ApplicationActivity | null>(null)
  const [activityError, setActivityError] = useState(false)
  const ownerRef = useRef<string | null>(null)
  const profileTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const refreshVersion = useRef(0)
  const refreshActivity = useCallback(async () => {
    const owner = ownerRef.current
    try {
      const next = await fetchApplicationActivity()
      if (owner !== ownerRef.current) return
      setActivity(next)
      setActivityError(false)
    } catch {
      if (owner === ownerRef.current) setActivityError(true)
    }
  }, [])

  const [hasLocalData, setHasLocalData] = useState(false)
  const anonymousData = useRef({
    profile: readAnonymous<Profile>('profile', EMPTY_PROFILE),
    saved: readAnonymous<SavedApplication[]>('saved', []),
    alerts: readAnonymous<AlertPreference[]>('alerts', []),
  })

  const signedIn = mode === 'signed-in'

  // The latest values, so a setter can diff against them when it is given
  // an updater function.
  const profileRef = useRef(profile)
  const savedRef = useRef(saved)
  const alertsRef = useRef(alerts)
  profileRef.current = profile
  savedRef.current = saved
  alertsRef.current = alerts

  const applySnapshot = useCallback((snapshot: AccountSnapshot) => {
    const backup = readLocal<typeof anonymousData.current | null>('anonymous-import', null)
    const local =
      backup ?? (!readLocal<string | null>('account-owner', null) ? anonymousData.current : null)
    if (
      local &&
      (local.profile.skills.length ||
        local.profile.targetRoleFamilies.length ||
        local.profile.targetSeniority.length ||
        local.profile.preferredWorkModes.length ||
        local.profile.workCountry ||
        local.saved.length ||
        local.alerts.length)
    ) {
      writeLocal('anonymous-import', local)
      setHasLocalData(true)
    }
    ownerRef.current = snapshot.user.id
    writeLocal('account-owner', snapshot.user.id)
    setUser(snapshot.user)
    setSubscription(snapshot.subscription)
    setEntitlements(snapshot.entitlements)
    setProfileState(snapshot.profile)
    setSavedState(snapshot.saved)
    setAlertsState(snapshot.alerts)
    writeLocal(`account:${snapshot.user.id}:profile`, snapshot.profile)
    writeLocal(`account:${snapshot.user.id}:saved`, snapshot.saved)
    writeLocal(`account:${snapshot.user.id}:alerts`, snapshot.alerts)
  }, [])

  const refresh = useCallback(async () => {
    const version = ++refreshVersion.current
    try {
      const snapshot = await fetchAccount()
      if (version !== refreshVersion.current) return
      if (ownerRef.current !== snapshot.user.id) clearTimeout(profileTimer.current)
      applySnapshot(snapshot)
      setMode('signed-in')
      setSyncError(null)
      await refreshActivity()
    } catch (error) {
      if (version !== refreshVersion.current) return
      clearTimeout(profileTimer.current)
      setMode('anonymous')
      setUser(null)
      setActivity(null)
      ownerRef.current = null
      const local =
        readLocal<typeof anonymousData.current | null>('anonymous-import', null) ||
        anonymousData.current
      setProfileState(local.profile)
      setSavedState(local.saved)
      setAlertsState(local.alerts)
      writeLocal('account-owner', null)
      writeLocal('profile', local.profile)
      writeLocal('saved', local.saved)
      writeLocal('alerts', local.alerts)
      if (!(error instanceof ApiError && error.status === 401)) {
        setSyncError(error instanceof Error ? error.message : String(error))
      }
    }
  }, [applySnapshot, refreshActivity])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useEffect(() => {
    let checkedAt = Date.now()
    const check = () => {
      if (document.visibilityState === 'visible' && Date.now() - checkedAt > 5 * 60000) {
        checkedAt = Date.now()
        void refresh()
      }
    }
    window.addEventListener('focus', check)
    return () => window.removeEventListener('focus', check)
  }, [refresh])

  useEffect(() => {
    const changed = (event: StorageEvent) => {
      if (
        event.key !== 'rolesignal:account-owner' ||
        event.newValue === JSON.stringify(ownerRef.current)
      )
        return
      clearTimeout(profileTimer.current)
      ownerRef.current = null
      setUser(null)
      setMode('loading')
      setProfileState(EMPTY_PROFILE)
      setSavedState([])
      setAlertsState([])
      setActivity(null)
      void refresh()
    }
    window.addEventListener('storage', changed)
    return () => window.removeEventListener('storage', changed)
  }, [refresh])

  const setProfile = useCallback<Setter<Profile>>(
    (value) => {
      const next = typeof value === 'function' ? value(profileRef.current) : value
      profileRef.current = next
      setProfileState(next)
      writeLocal(signedIn ? `account:${ownerRef.current}:profile` : 'profile', next)
      if (!signedIn) {
        anonymousData.current.profile = next
        writeLocal('anonymous-import', anonymousData.current)
        return
      }

      // Profile edits arrive one keystroke at a time, so they are coalesced.
      if (profileTimer.current !== undefined) window.clearTimeout(profileTimer.current)
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
      writeLocal(signedIn ? `account:${ownerRef.current}:saved` : 'saved', next)
      if (!signedIn) {
        anonymousData.current.saved = next
        writeLocal('anonymous-import', anonymousData.current)
        return
      }

      for (const entry of next) {
        const before = previous.find((item) => item.jobId === entry.jobId)
        if (!before || before.status !== entry.status) {
          void postSaved(entry.jobId, entry.status)
            .then(refreshActivity)
            .catch((error: unknown) => {
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
    [signedIn, refreshActivity],
  )

  const setAlerts = useCallback<Setter<AlertPreference[]>>(
    (value) => {
      const previous = alertsRef.current
      const next = typeof value === 'function' ? value(previous) : value
      alertsRef.current = next
      setAlertsState(next)
      writeLocal(signedIn ? `account:${ownerRef.current}:alerts` : 'alerts', next)
      if (!signedIn) {
        anonymousData.current.alerts = next
        writeLocal('anonymous-import', anonymousData.current)
        return
      }

      for (const entry of next) {
        const before = previous.find((item) => item.id === entry.id)
        if (!before) {
          void postAlert(entry).catch((error: unknown) => {
            setSyncError(error instanceof Error ? error.message : String(error))
          })
        } else if (
          before.label !== entry.label ||
          before.query !== entry.query ||
          JSON.stringify(before.channels) !== JSON.stringify(entry.channels) ||
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
    const local =
      readLocal<typeof anonymousData.current | null>('anonymous-import', null) ??
      anonymousData.current
    const result = await importAccount(local)
    writeLocal('anonymous-import', null)
    anonymousData.current = { profile: EMPTY_PROFILE, saved: [], alerts: [] }
    setHasLocalData(false)
    await refresh()
    return result
  }, [refresh])

  useEffect(
    () => () => {
      if (profileTimer.current !== undefined) window.clearTimeout(profileTimer.current)
    },
    [],
  )

  return {
    activity,
    activityError,
    hasLocalData,
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
