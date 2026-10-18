/** Trusted deploy-only provider check. No account, email, CV or key is logged. */
import { readFile } from 'node:fs/promises'
import ts from 'typescript'
import { decodeHTML } from 'entities'
import { franc } from 'franc-min'

if (!process.env.OPENROUTER_API_KEY?.trim()) {
  console.log('::warning title=OpenRouter check::No encrypted provider credential is configured.')
} else {
  let status = null
  try {
    const response = await fetch(
      'https://boards-api.greenhouse.io/v1/boards/givedirectly/jobs?content=true',
      { signal: AbortSignal.timeout(15000) },
    )
    if (!response.ok) throw new Error('source')
    const body = await response.json()
    const job = body.jobs?.find((item) => item.language === 'fr' && item.content)
    if (!job) throw new Error('source')
    const description = decodeHTML(job.content)
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .slice(0, 1800)
    const source = await readFile(new URL('../src/server/openrouter.ts', import.meta.url), 'utf8')
    const js = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    }).outputText
    const { openRouterJson } = await import(
      `data:text/javascript;base64,${Buffer.from(js).toString('base64')}`
    )
    const result = await openRouterJson(
      { OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY },
      'Translate this public job-description excerpt into English. Preserve its facts, do not summarize or add information. Return {"description":"English plain text"}.',
      { description },
      1800,
      async (...args) => {
        const r = await fetch(...args)
        status = r.status
        return r
      },
    )
    if (
      typeof result.description !== 'string' ||
      result.description.length < 100 ||
      franc(result.description, { minLength: 60 }) !== 'eng'
    )
      throw new Error('validation')
    console.log(
      '::notice title=OpenRouter live verification::The deployed provider adapter returned validated English for a real public French job excerpt. No user profile/CV was sent. This does not verify a database-backed user session.',
    )
  } catch {
    console.log(
      `::warning title=OpenRouter live verification::The credential is present, but the live translation probe did not pass. Provider HTTP status: ${status ?? 'not reached'}. No provider response or credential was logged.`,
    )
  }
}
