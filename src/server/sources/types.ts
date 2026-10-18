import type { SalaryPeriod } from '../../shared/types'

export interface RawSalary {
  min: number | null
  max: number | null
  currency: string | null
  period: SalaryPeriod
}

export interface RawPosting {
  /** The source's own identifier for the posting. */
  externalId: string
  title: string
  company: string
  description: string
  url: string
  location: string
  remote: boolean
  tags: string[]
  jobType: string
  publishedAt: string | null
  salary: RawSalary | null
}

/**
 * A job source. Adapters only need to fetch and shape the source's own
 * payload; normalisation into the canonical posting shape happens once, in
 * one place, so every source is held to the same standard.
 */
export interface SourceAdapter {
  id: string
  name: string
  homepage: string
  /** Terms or attribution note that should be shown alongside the source. */
  attribution: string
  fetchPostings(fetchImpl?: typeof fetch): Promise<RawPosting[]>
}

export class SourceError extends Error {
  constructor(
    message: string,
    readonly sourceId: string,
  ) {
    super(message)
    this.name = 'SourceError'
  }
}
