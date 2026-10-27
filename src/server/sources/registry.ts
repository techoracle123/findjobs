import type { SourceParser } from './types'
import { arbeitnow } from './arbeitnow'
import { remotive } from './remotive'
import { ATS_PARSERS } from './ats'
import { breezy, personio, teamtailor } from './ats-modern'
import { FEED_PARSERS } from './feeds'
import { PUBLIC_BOARD_PARSERS } from './public-boards'

const PARSERS: Record<string, SourceParser> = {}

for (const parser of [
  arbeitnow,
  remotive,
  ...ATS_PARSERS,
  teamtailor,
  personio,
  breezy,
  ...FEED_PARSERS,
  ...PUBLIC_BOARD_PARSERS,
]) {
  PARSERS[parser.id] = parser
}

export function getParser(id: string): SourceParser | undefined {
  return PARSERS[id]
}

export function listParsers(): SourceParser[] {
  return Object.values(PARSERS)
}

export const DEFAULT_SOURCE_IDS = Object.keys(PARSERS)
