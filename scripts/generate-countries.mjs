/**
 * Renders the ISO 3166-1 alpha-2 region list into src/shared/country-data.ts.
 *
 * The list was previously hand-written and had drifted: Nigeria was missing
 * and a non-existent "BIR" code had crept in. It is now generated from the
 * i18n-iso-countries package so it cannot be wrong by hand.
 *
 * Antarctica is excluded because it is not a place people work. Kosovo is
 * included because it is a user-assigned code that is widely used for work
 * locations.
 *
 * Usage: npm run data:generate
 */
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const iso = require('i18n-iso-countries')

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const targetPath = join(root, 'src', 'shared', 'country-data.ts')

const EXCLUDED = new Set(['AQ'])

const names = iso.getNames('en')
const codes = Object.keys(iso.getAlpha2Codes())
  .filter((code) => !EXCLUDED.has(code))
  .sort()

const entries = codes
  .map((code) => {
    const name = names[code] ?? code
    return `${code}:${name.replace(/[;]/g, ',')}`
  })
  .join(';')

// JSON.stringify produces a correctly escaped literal; several country names
// contain an apostrophe ("Côte d'Ivoire") which would otherwise break the
// generated file.
const contents = `/**
 * GENERATED FILE — do not edit by hand.
 *
 * Source: the \`i18n-iso-countries\` package (ISO 3166-1 alpha-2, English
 * names). Antarctica is excluded; Kosovo is included as a user-assigned code.
 *
 * Regenerate with: npm run data:generate
 */
export const COUNTRY_DATA = ${JSON.stringify(entries)}
`

writeFileSync(targetPath, contents, 'utf8')

console.log(`Wrote ${codes.length} regions to src/shared/country-data.ts`)
