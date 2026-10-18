import type { SourceAdapter } from './types'
import { arbeitnow } from './arbeitnow'
import { remotive } from './remotive'

const ADAPTERS: Record<string, SourceAdapter> = {
  arbeitnow,
  remotive,
}

export function getAdapter(id: string): SourceAdapter | undefined {
  return ADAPTERS[id]
}

export function listAdapters(): SourceAdapter[] {
  return Object.values(ADAPTERS)
}

export const DEFAULT_SOURCE_IDS = Object.keys(ADAPTERS)
