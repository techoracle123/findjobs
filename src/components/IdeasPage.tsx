import { useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  Bookmark,
  BookmarkCheck,
  Check,
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  Globe2,
  Lightbulb,
  MapPin,
  Package,
  RefreshCw,
  Search,
  Share2,
  Smartphone,
  TrendingUp,
  Users,
} from 'lucide-react'
import { Footer } from './Footer'
import { SiteHeader } from './SiteHeader'
import { fetchIdea, fetchIdeas, fetchIdeaTrends } from '../lib/ideas'
import { getIdeaGuidance } from '../shared/idea-guidance'
import {
  IDEA_FORMAT_LABELS,
  IDEA_PLAIN_FIGURE_LABELS,
  IDEA_ROUTE_LABELS,
  IDEA_UNIT_LABELS,
  type IdeaListResponse,
  type LiveTrend,
  type ProductIdea,
  type TrendResponse,
} from '../shared/ideas'

const PAGE_SIZE = 24
const SAVED_KEY = 'fj-saved-product-ideas-v1'
const CHECK_KEY = 'fj-product-idea-checks-v1'

type IdeaTab = 'ideas' | 'trends' | 'saved'

function number(value: number): string {
  return value.toLocaleString('en-NG')
}

function date(value: string): string {
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime())
    ? 'Date not stated'
    : parsed.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

function dateTime(value: string): string {
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime())
    ? 'Time unavailable'
    : parsed.toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' })
}

function readSaved(): ProductIdea[] {
  try {
    const value = JSON.parse(localStorage.getItem(SAVED_KEY) || '[]') as unknown
    if (!Array.isArray(value)) return []
    return value
      .filter((entry): entry is ProductIdea =>
        Boolean(entry && typeof entry.id === 'string' && typeof entry.title === 'string'),
      )
      .slice(0, 200)
  } catch {
    return []
  }
}

function FormatIcon({ idea }: { idea: ProductIdea }) {
  return idea.format === 'software' ? <Smartphone size={15} /> : <Package size={15} />
}

function IdeaCard({
  idea,
  saved,
  onToggleSaved,
}: {
  idea: ProductIdea
  saved: boolean
  onToggleSaved: (idea: ProductIdea) => void
}) {
  return (
    <article className="idea-card">
      <div className="idea-card__topline">
        <span className="idea-format">
          <FormatIcon idea={idea} /> {IDEA_FORMAT_LABELS[idea.format]}
        </span>
        <button
          className="icon-button"
          type="button"
          aria-label={saved ? `Remove ${idea.title} from saved ideas` : `Save ${idea.title}`}
          aria-pressed={saved}
          onClick={() => onToggleSaved(idea)}
        >
          {saved ? <BookmarkCheck size={19} /> : <Bookmark size={19} />}
        </button>
      </div>
      <p className="idea-card__location">
        <MapPin size={14} /> {idea.location.name} <span>·</span> {idea.categoryLabel}
      </p>
      <h2>
        <a href={`/ideas/${encodeURIComponent(idea.id)}`}>{idea.title}</a>
      </h2>
      <p className="idea-card__product">{idea.product}</p>
      <div className="idea-evidence-chip">
        <strong>{idea.evidence.displayValue}</strong>
        <span>
          {IDEA_PLAIN_FIGURE_LABELS[idea.evidence.indicatorId] ?? idea.evidence.indicatorName},{' '}
          {idea.evidence.year}
        </span>
      </div>
      <p className="idea-card__buyer">
        <Users size={14} /> For {idea.buyer}
      </p>
      <a className="idea-card__link" href={`/ideas/${encodeURIComponent(idea.id)}`}>
        See how to start <ArrowRight size={15} />
      </a>
    </article>
  )
}

function TrendCard({ trend }: { trend: LiveTrend }) {
  return (
    <article className="trend-card">
      <div className="trend-card__heading">
        <TrendingUp size={19} aria-hidden="true" />
        <div>
          <h2>{trend.query}</h2>
          <p>
            {trend.countryName} · started {dateTime(trend.startedAt)}
          </p>
        </div>
        <strong>{trend.trafficLabel}</strong>
      </div>
      <p className="trend-traffic-note">
        Google’s rough estimate of search interest. It is not an exact count and does not prove
        people will buy.
      </p>
      {trend.news.length ? (
        <div className="trend-news">
          <span>Related reporting</span>
          {trend.news.map((item) => (
            <a key={item.url} href={item.url} target="_blank" rel="noopener noreferrer">
              {item.source ? `${item.source}: ` : ''}
              {item.title} <ExternalLink size={13} />
            </a>
          ))}
        </div>
      ) : null}
      <div className="trend-card__actions">
        <a href={trend.exploreUrl} target="_blank" rel="noopener noreferrer">
          Open in Google Trends <ExternalLink size={14} />
        </a>
        <a href={`/ideas?country=ALL&q=${encodeURIComponent(trend.query)}`}>
          Look for related product ideas <ArrowRight size={14} />
        </a>
      </div>
    </article>
  )
}

export function IdeasPage() {
  const initial = useMemo(() => new URLSearchParams(window.location.search), [])
  const [tab, setTab] = useState<IdeaTab>('ideas')
  const [country, setCountry] = useState((initial.get('country') || 'NGA').toUpperCase())
  const [category, setCategory] = useState(initial.get('category') || '')
  const [format, setFormat] = useState(initial.get('format') || '')
  const [route, setRoute] = useState(initial.get('route') || '')
  const [query, setQuery] = useState(initial.get('q') || '')
  const [searchInput, setSearchInput] = useState(initial.get('q') || '')
  const [sort, setSort] = useState(initial.get('sort') || 'evidence')
  const [page, setPage] = useState(Math.max(1, Number(initial.get('page')) || 1))
  const [data, setData] = useState<IdeaListResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState<ProductIdea[]>(readSaved)
  const [trendGeo, setTrendGeo] = useState('NG')
  const [trends, setTrends] = useState<TrendResponse | null>(null)
  const [trendError, setTrendError] = useState('')
  const [trendLoading, setTrendLoading] = useState(false)
  const [trendReload, setTrendReload] = useState(0)

  const savedIds = useMemo(() => new Set(saved.map((idea) => idea.id)), [saved])
  const toggleSaved = (idea: ProductIdea) => {
    setSaved((current) => {
      const next = current.some((entry) => entry.id === idea.id)
        ? current.filter((entry) => entry.id !== idea.id)
        : [idea, ...current].slice(0, 200)
      try {
        localStorage.setItem(SAVED_KEY, JSON.stringify(next))
      } catch {
        // The visible list still works if storage is full or disabled.
      }
      return next
    })
  }

  useEffect(() => {
    document.title = 'Practical ideas by place | FJ'
  }, [])

  useEffect(() => {
    if (tab === 'saved') {
      setLoading(false)
      return
    }
    if (tab === 'trends') return
    const controller = new AbortController()
    const params = new URLSearchParams({
      country,
      sort,
      limit: String(PAGE_SIZE),
      offset: String((page - 1) * PAGE_SIZE),
    })
    if (category) params.set('category', category)
    if (format) params.set('format', format)
    if (route) params.set('route', route)
    if (query.trim()) params.set('q', query.trim())
    setLoading(true)
    setError('')
    fetchIdeas(params, controller.signal)
      .then((result) => {
        setData(result)
        if (result.total > 0 && (page - 1) * PAGE_SIZE >= result.total) setPage(1)
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted)
          setError(reason instanceof Error ? reason.message : 'Ideas could not be loaded.')
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    const url = new URLSearchParams()
    if (country !== 'NGA') url.set('country', country)
    if (category) url.set('category', category)
    if (format) url.set('format', format)
    if (route) url.set('route', route)
    if (query.trim()) url.set('q', query.trim())
    if (sort !== 'evidence') url.set('sort', sort)
    if (page > 1) url.set('page', String(page))
    window.history.replaceState(null, '', `/ideas${url.size ? `?${url}` : ''}`)
    return () => controller.abort()
  }, [tab, country, category, format, route, query, sort, page])

  useEffect(() => {
    if (tab !== 'trends') return
    const controller = new AbortController()
    setTrendLoading(true)
    setTrendError('')
    fetchIdeaTrends(trendGeo, controller.signal)
      .then(setTrends)
      .catch((reason: unknown) => {
        if (!controller.signal.aborted)
          setTrendError(reason instanceof Error ? reason.message : 'Trends could not be loaded.')
      })
      .finally(() => {
        if (!controller.signal.aborted) setTrendLoading(false)
      })
    return () => controller.abort()
  }, [tab, trendGeo, trendReload])

  const submitSearch = (event: FormEvent) => {
    event.preventDefault()
    setPage(1)
    setQuery(searchInput.trim())
  }
  const resetPage = <T,>(setter: (value: T) => void, value: T) => {
    setter(value)
    setPage(1)
  }
  const clearFilters = () => {
    setCountry('NGA')
    setCategory('')
    setFormat('')
    setRoute('')
    setQuery('')
    setSearchInput('')
    setSort('evidence')
    setPage(1)
  }
  const shownIdeas = tab === 'saved' ? saved : (data?.ideas ?? [])
  const totalPages = Math.max(1, Math.ceil((data?.total ?? 0) / PAGE_SIZE))
  const resultLabel =
    route === 'build'
      ? 'ideas to make yourself'
      : route === 'sell'
        ? 'ideas to buy and resell'
        : route === 'both'
          ? 'ideas to make or buy'
          : 'ideas found'

  return (
    <div className="app ideas-app">
      <SiteHeader current="ideas" />
      <main className="ideas-main" id="main">
        <section className="ideas-hero">
          <div>
            <p className="eyebrow">
              <Lightbulb size={16} /> Ideas you can test
            </p>
            <h1>Find a practical idea to build or sell.</h1>
            <p>
              Choose a place and find something people may need. Start small, talk to possible
              customers and check the costs before you spend money.
            </p>
            <div className="ideas-hero__actions">
              <a className="btn btn--primary" href="#idea-results">
                Explore ideas <ArrowRight size={17} />
              </a>
              <button
                className="btn btn--dark-ghost"
                type="button"
                onClick={() => setTab('trends')}
              >
                See trending searches <TrendingUp size={17} />
              </button>
            </div>
          </div>
          <div className="ideas-hero__stats" aria-label="Ideas summary">
            <div>
              <strong>{data ? number(data.catalogTotal) : '—'}</strong>
              <span>ideas for different places</span>
            </div>
            <div>
              <strong>{data ? number(data.evidence.countryCount) : '—'}</strong>
              <span>countries covered</span>
            </div>
            <div>
              <strong>{data?.evidence.indicatorCount ?? 15}</strong>
              <span>types of local figures</span>
            </div>
          </div>
        </section>

        <div className="ideas-trust-strip">
          <strong>No idea is guaranteed to make money.</strong>
          <span>
            The local figures give background. They are not success scores and do not show whether
            people will buy. Talk to people and test the idea before you spend money.
          </span>
        </div>

        <nav className="ideas-tabs" aria-label="Ideas and trends">
          <button
            type="button"
            className={tab === 'ideas' ? 'active' : ''}
            onClick={() => setTab('ideas')}
          >
            Product ideas
          </button>
          <button
            type="button"
            className={tab === 'trends' ? 'active' : ''}
            onClick={() => setTab('trends')}
          >
            Trending searches
          </button>
          <button
            type="button"
            className={tab === 'saved' ? 'active' : ''}
            onClick={() => setTab('saved')}
          >
            Saved on this device ({saved.length})
          </button>
        </nav>

        {tab === 'trends' ? (
          <section className="trends-panel" aria-labelledby="trends-heading">
            <div className="trends-panel__head">
              <div>
                <p className="eyebrow">What people are searching for</p>
                <h2 id="trends-heading">Trending searches by country</h2>
                <p>
                  A trending search is not proof of a good business idea. Look for a real problem,
                  then speak to the people who have it.
                </p>
              </div>
              <div className="trend-controls">
                <label>
                  <span>Trend location</span>
                  <select value={trendGeo} onChange={(event) => setTrendGeo(event.target.value)}>
                    {(data?.countries ?? [])
                      .filter((entry) => entry.iso2.length === 2 && entry.iso2 !== 'WW')
                      .map((entry) => (
                        <option value={entry.iso2} key={entry.iso3}>
                          {entry.name}
                        </option>
                      ))}
                    {!data ? <option value="NG">Nigeria</option> : null}
                  </select>
                </label>
                <button
                  className="icon-button"
                  type="button"
                  aria-label="Check for new trending searches"
                  onClick={() => setTrendReload((value) => value + 1)}
                >
                  <RefreshCw size={18} />
                </button>
              </div>
            </div>
            {trendLoading ? (
              <p className="ideas-loading" role="status">
                Loading current trends…
              </p>
            ) : null}
            {trendError ? (
              <div className="banner banner--demo" role="alert">
                {trendError}
              </div>
            ) : null}
            {trends?.stale ? <p className="banner banner--demo">{trends.message}</p> : null}
            {trends ? (
              <>
                <p className="trend-source-note">
                  Collected {dateTime(trends.fetchedAt)} from{' '}
                  <a href={trends.sourceUrl} target="_blank" rel="noopener noreferrer">
                    {trends.sourceName}
                  </a>
                  . Google chooses which searches appear and how they are ranked.
                </p>
                {trends.trends.length ? (
                  <div className="trend-grid">
                    {trends.trends.map((trend) => (
                      <TrendCard trend={trend} key={trend.id} />
                    ))}
                  </div>
                ) : (
                  <p>
                    No trending searches were published for this place just now. Try another country
                    or look through the product ideas.
                  </p>
                )}
              </>
            ) : null}
          </section>
        ) : (
          <>
            {tab === 'ideas' ? (
              <section className="idea-filters" aria-label="Filter product ideas">
                <form className="idea-search" onSubmit={submitSearch}>
                  <Search size={18} aria-hidden="true" />
                  <label className="visually-hidden" htmlFor="idea-search-input">
                    Search product ideas
                  </label>
                  <input
                    id="idea-search-input"
                    value={searchInput}
                    onChange={(event) => setSearchInput(event.target.value)}
                    placeholder="Try solar, water, repairs, learning or delivery"
                  />
                  <button className="btn btn--primary" type="submit">
                    Search ideas
                  </button>
                </form>
                <div className="idea-filter-row">
                  <label>
                    <span>Place</span>
                    <select
                      value={country}
                      onChange={(event) => resetPage(setCountry, event.target.value)}
                    >
                      <option value="ALL">All locations</option>
                      {!data ? <option value="NGA">Nigeria</option> : null}
                      {data?.countries.map((entry) => (
                        <option value={entry.iso3} key={entry.iso3}>
                          {entry.name} ({number(entry.count)})
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span>Product type</span>
                    <select
                      value={format}
                      onChange={(event) => resetPage(setFormat, event.target.value)}
                    >
                      <option value="">All types</option>
                      <option value="physical">Physical products</option>
                      <option value="software">Software or apps</option>
                      <option value="hybrid">Products with software</option>
                    </select>
                  </label>
                  <label>
                    <span>How to start</span>
                    <select
                      value={route}
                      onChange={(event) => resetPage(setRoute, event.target.value)}
                    >
                      <option value="">All ways</option>
                      <option value="build">Make it myself</option>
                      <option value="sell">Buy and resell</option>
                      <option value="both">Make or buy</option>
                    </select>
                  </label>
                  <label>
                    <span>Order</span>
                    <select
                      value={sort}
                      onChange={(event) => resetPage(setSort, event.target.value)}
                    >
                      <option value="evidence">Largest gap in the local figure</option>
                      <option value="recent">Newest local figures</option>
                    </select>
                  </label>
                </div>
                {country !== 'NGA' ||
                category ||
                format ||
                route ||
                query ||
                sort !== 'evidence' ||
                page > 1 ? (
                  <button className="idea-clear-filters" type="button" onClick={clearFilters}>
                    Clear all filters
                  </button>
                ) : null}
                <div className="idea-category-scroll" aria-label="Idea fields">
                  <button
                    type="button"
                    className={!category ? 'active' : ''}
                    onClick={() => resetPage(setCategory, '')}
                  >
                    All topics
                  </button>
                  {data?.facets.categories.map((entry) => (
                    <button
                      type="button"
                      className={category === entry.id ? 'active' : ''}
                      key={entry.id}
                      onClick={() => resetPage(setCategory, entry.id)}
                    >
                      {entry.label} <span>{number(entry.count)}</span>
                    </button>
                  ))}
                </div>
              </section>
            ) : (
              <section className="saved-ideas-intro">
                <h2>Your saved ideas</h2>
                <p>Saved only in this browser. No account or payment is needed.</p>
              </section>
            )}

            <section className="idea-results" id="idea-results" aria-live="polite">
              <div className="idea-results__head">
                <div>
                  <p className="eyebrow">
                    {tab === 'saved' ? 'Your shortlist' : 'Ideas linked to local figures'}
                  </p>
                  <h2>
                    {tab === 'saved'
                      ? `${number(saved.length)} saved`
                      : `${number(data?.total ?? 0)} ${resultLabel}`}
                  </h2>
                </div>
                {data && tab === 'ideas' ? (
                  <p>
                    Figures checked {date(data.evidence.refreshedAt)} · Source updated{' '}
                    {data.evidence.sourceLastUpdated}
                  </p>
                ) : null}
              </div>
              {loading ? (
                <p className="ideas-loading" role="status">
                  Loading product ideas…
                </p>
              ) : null}
              {error ? (
                <div className="banner banner--demo" role="alert">
                  {error}
                </div>
              ) : null}
              {!loading && !error && shownIdeas.length === 0 ? (
                <div className="ideas-empty">
                  <Globe2 size={28} />
                  <h3>{tab === 'saved' ? 'No saved ideas yet' : 'No ideas match those filters'}</h3>
                  <p>
                    {tab === 'saved'
                      ? 'Save an idea to build a private shortlist on this device.'
                      : 'Try all locations, another topic or a broader search.'}
                  </p>
                </div>
              ) : null}
              <div className="idea-grid">
                {shownIdeas.map((idea) => (
                  <IdeaCard
                    idea={idea}
                    saved={savedIds.has(idea.id)}
                    onToggleSaved={toggleSaved}
                    key={idea.id}
                  />
                ))}
              </div>
              {tab === 'ideas' && data && data.total > PAGE_SIZE ? (
                <nav className="idea-pagination" aria-label="Idea pages">
                  <button
                    className="btn"
                    type="button"
                    disabled={page <= 1}
                    onClick={() => setPage((value) => Math.max(1, value - 1))}
                  >
                    <ChevronLeft size={16} /> Previous
                  </button>
                  <span>
                    Page {page} of {totalPages}
                  </span>
                  <button
                    className="btn"
                    type="button"
                    disabled={page >= totalPages}
                    onClick={() => setPage((value) => Math.min(totalPages, value + 1))}
                  >
                    Next <ChevronRight size={16} />
                  </button>
                </nav>
              ) : null}
            </section>
          </>
        )}
      </main>
      <Footer />
    </div>
  )
}

export function IdeaDetailPage({ id }: { id: string }) {
  const [result, setResult] = useState<{ idea: ProductIdea; related: ProductIdea[] } | null>(null)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState<ProductIdea[]>(readSaved)
  const [checks, setChecks] = useState<boolean[]>([])
  const [shareNotice, setShareNotice] = useState('')

  useEffect(() => {
    const controller = new AbortController()
    fetchIdea(id, controller.signal)
      .then((data) => {
        setResult(data)
        document.title = `${data.idea.title} | FJ Ideas`
        try {
          const all = JSON.parse(localStorage.getItem(CHECK_KEY) || '{}') as Record<
            string,
            boolean[]
          >
          setChecks(all[id] ?? data.idea.validationSteps.map(() => false))
        } catch {
          setChecks(data.idea.validationSteps.map(() => false))
        }
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted)
          setError(reason instanceof Error ? reason.message : 'Idea could not be loaded.')
      })
    return () => controller.abort()
  }, [id])

  const idea = result?.idea
  const guidance = idea ? getIdeaGuidance(idea.format) : null
  const isSaved = Boolean(idea && saved.some((entry) => entry.id === idea.id))
  const toggleSaved = () => {
    if (!idea) return
    const next = isSaved
      ? saved.filter((entry) => entry.id !== idea.id)
      : [idea, ...saved].slice(0, 200)
    setSaved(next)
    try {
      localStorage.setItem(SAVED_KEY, JSON.stringify(next))
    } catch {
      /* Device storage is optional. */
    }
  }
  const setCheck = (index: number) => {
    if (!idea) return
    const next = checks.map((value, position) => (position === index ? !value : value))
    setChecks(next)
    try {
      const all = JSON.parse(localStorage.getItem(CHECK_KEY) || '{}') as Record<string, boolean[]>
      localStorage.setItem(CHECK_KEY, JSON.stringify({ ...all, [id]: next }))
    } catch {
      /* The checklist still works for this open page. */
    }
  }
  const share = async () => {
    if (!idea) return
    setShareNotice('')
    try {
      if (navigator.share) {
        await navigator.share({ title: idea.title, text: idea.product, url: window.location.href })
        return
      }
      if (!navigator.clipboard?.writeText) {
        setShareNotice('Copy the idea link from your browser address bar.')
        return
      }
      await navigator.clipboard.writeText(window.location.href)
      setShareNotice('Idea link copied.')
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === 'AbortError') return
      setShareNotice('The link could not be shared. Copy it from your browser address bar.')
    }
  }
  const download = () => {
    if (!idea) return
    const guide = getIdeaGuidance(idea.format)
    const text = [
      idea.title,
      '',
      `THE IDEA: ${idea.product}`,
      `WHO IT IS FOR: ${idea.buyer}`,
      `HOW TO START: ${IDEA_ROUTE_LABELS[idea.route]}`,
      `SMALL FIRST VERSION: ${idea.firstVersion}`,
      `HOW YOU COULD CHARGE: ${idea.revenueModel}`,
      '',
      'HOW TO MAKE THE FIRST VERSION',
      guide.intro,
      ...guide.steps.map((step, index) => `${index + 1}. ${step}`),
      '',
      'WHAT YOU MAY NEED',
      ...guide.tools.map((item) => `- ${item}`),
      '',
      'COSTS TO CHECK',
      ...guide.costs.map((item) => `- ${item}`),
      'FJ does not estimate these costs because they vary by place and supplier.',
      '',
      `LOCAL BACKGROUND FIGURE: ${idea.evidence.indicatorName}: ${idea.evidence.displayValue} (${idea.evidence.year})`,
      `EXACT VALUE FROM SOURCE: ${idea.evidence.value}`,
      `MEASURED IN: ${IDEA_UNIT_LABELS[idea.evidence.unit]}`,
      `SOURCE UPDATED: ${idea.evidence.sourceLastUpdated}`,
      `SOURCE: ${idea.evidence.sourceName}`,
      `SOURCE LINK: ${idea.evidence.sourceUrl}`,
      `WHAT THE FIGURE CANNOT TELL YOU: ${idea.evidence.interpretation}`,
      '',
      'CHECKS BEFORE SPENDING MONEY',
      ...idea.validationSteps.map((step, index) => `${index + 1}. ${step}`),
      '',
      'SAFETY AND LIMITS',
      ...idea.risks.map((risk) => `- ${risk}`),
      '',
      'This is an idea to test, not proof that people will buy it or that the business will succeed.',
    ].join('\n')
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `${idea.conceptId}-idea-checklist.txt`
    anchor.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  return (
    <div className="app ideas-app">
      <SiteHeader current="ideas" />
      <main className="ideas-main idea-detail-main" id="main">
        <a
          className="idea-back"
          href={
            idea ? `/ideas?country=${idea.location.iso3}&category=${idea.categoryId}` : '/ideas'
          }
        >
          <ArrowLeft size={16} /> Back to product ideas
        </a>
        {error ? (
          <div className="banner banner--demo" role="alert">
            {error}
          </div>
        ) : null}
        {!idea && !error ? (
          <p className="ideas-loading" role="status">
            Loading the idea and its local figures…
          </p>
        ) : null}
        {idea ? (
          <>
            <header className="idea-detail-hero">
              <div>
                <p className="eyebrow">
                  <FormatIcon idea={idea} /> {IDEA_FORMAT_LABELS[idea.format]} ·{' '}
                  {idea.categoryLabel}
                </p>
                <h1>{idea.title}</h1>
                <p>{idea.product}</p>
              </div>
              <div className="idea-detail-actions">
                <button className="btn" type="button" onClick={toggleSaved}>
                  {isSaved ? <BookmarkCheck size={17} /> : <Bookmark size={17} />}
                  {isSaved ? 'Saved' : 'Save idea'}
                </button>
                <button className="btn" type="button" onClick={() => void share()}>
                  <Share2 size={17} /> Share idea
                </button>
                <button className="btn btn--primary" type="button" onClick={download}>
                  <Download size={17} /> Download idea
                </button>
              </div>
              <p className="field__hint" aria-live="polite">
                {shareNotice}
              </p>
            </header>
            <div className="idea-detail-layout">
              <div className="idea-detail-content">
                <section>
                  <p className="eyebrow">Who this could help</p>
                  <h2>Why this idea may be useful</h2>
                  <p>{idea.problem}</p>
                  <p>
                    <strong>Who it is for:</strong> {idea.buyer}
                  </p>
                </section>
                <section>
                  <p className="eyebrow">A small first version</p>
                  <h2>Start small and learn what works</h2>
                  <p>{idea.firstVersion}</p>
                  <div className="idea-detail-facts">
                    <div>
                      <span>How to start</span>
                      <strong>{IDEA_ROUTE_LABELS[idea.route]}</strong>
                    </div>
                    <div>
                      <span>Time for the first test</span>
                      <strong>{idea.testWindow}</strong>
                    </div>
                    <div>
                      <span>How you could charge</span>
                      <strong>{idea.revenueModel}</strong>
                    </div>
                  </div>
                </section>
                {guidance ? (
                  <section className="idea-build-section">
                    <p className="eyebrow">How to make it</p>
                    <h2>Build the first version</h2>
                    <p>{guidance.intro}</p>
                    <ol className="idea-build-steps">
                      {guidance.steps.map((step, index) => (
                        <li key={step}>
                          <strong>Step {index + 1}</strong>
                          <span>{step}</span>
                        </li>
                      ))}
                    </ol>
                    <div className="idea-start-grid">
                      <div>
                        <h3>What you may need</h3>
                        <ul>
                          {guidance.tools.map((item) => (
                            <li key={item}>{item}</li>
                          ))}
                        </ul>
                      </div>
                      <div>
                        <h3>Costs to check</h3>
                        <ul>
                          {guidance.costs.map((item) => (
                            <li key={item}>{item}</li>
                          ))}
                        </ul>
                        <p>
                          FJ does not estimate these costs because they vary by place and supplier.
                        </p>
                      </div>
                    </div>
                  </section>
                ) : null}
                <section className="validation-section">
                  <p className="eyebrow">Before you spend money</p>
                  <h2>Check the idea with real people</h2>
                  <p>
                    {checks.filter(Boolean).length} of {idea.validationSteps.length} steps done on
                    this device. This is your checklist, not proof that people will buy.
                  </p>
                  <div className="validation-list">
                    {idea.validationSteps.map((step, index) => (
                      <label key={step} className={checks[index] ? 'checked' : ''}>
                        <input
                          type="checkbox"
                          checked={Boolean(checks[index])}
                          onChange={() => setCheck(index)}
                        />
                        <span className="validation-check">
                          {checks[index] ? <Check size={16} /> : null}
                        </span>
                        <span>
                          <strong>Step {index + 1}</strong>
                          {step}
                        </span>
                      </label>
                    ))}
                  </div>
                </section>
                <section>
                  <p className="eyebrow">Safety and limits</p>
                  <h2>Stay safe and check the rules</h2>
                  <ul className="idea-risk-list">
                    {idea.risks.map((risk) => (
                      <li key={risk}>{risk}</li>
                    ))}
                  </ul>
                  <p>
                    <strong>Useful skills:</strong> {idea.skills.join(', ')}.
                  </p>
                </section>
              </div>
              <aside className="idea-evidence-panel">
                <p className="eyebrow">Local background figure</p>
                <strong className="idea-evidence-value">{idea.evidence.displayValue}</strong>
                <h2>
                  {IDEA_PLAIN_FIGURE_LABELS[idea.evidence.indicatorId] ??
                    idea.evidence.indicatorName}
                </h2>
                <p>
                  {idea.location.name} · {idea.evidence.year}
                </p>
                <p>{idea.evidence.interpretation}</p>
                <dl>
                  <div>
                    <dt>Exact value from the source</dt>
                    <dd>{idea.evidence.value}</dd>
                  </div>
                  <div>
                    <dt>Measured in</dt>
                    <dd>{IDEA_UNIT_LABELS[idea.evidence.unit]}</dd>
                  </div>
                  <div>
                    <dt>Source updated</dt>
                    <dd>{idea.evidence.sourceLastUpdated}</dd>
                  </div>
                  <div>
                    <dt>Year</dt>
                    <dd>{idea.evidence.year}</dd>
                  </div>
                </dl>
                <a href={idea.evidence.sourceUrl} target="_blank" rel="noopener noreferrer">
                  See the World Bank figures <ExternalLink size={14} />
                </a>
                <small>
                  {idea.evidence.sourceName}. FJ wrote this idea for the location. The World Bank
                  supplies the figure but does not recommend the idea or say it will make money.
                </small>
              </aside>
            </div>
            {result?.related.length ? (
              <section className="related-ideas">
                <p className="eyebrow">Same topic and place</p>
                <h2>More ideas to compare</h2>
                <div className="idea-grid">
                  {result.related.map((entry) => (
                    <IdeaCard
                      idea={entry}
                      saved={saved.some((item) => item.id === entry.id)}
                      onToggleSaved={(selected) => {
                        const next = saved.some((item) => item.id === selected.id)
                          ? saved.filter((item) => item.id !== selected.id)
                          : [selected, ...saved].slice(0, 200)
                        setSaved(next)
                        try {
                          localStorage.setItem(SAVED_KEY, JSON.stringify(next))
                        } catch {
                          /* optional */
                        }
                      }}
                      key={entry.id}
                    />
                  ))}
                </div>
              </section>
            ) : null}
          </>
        ) : null}
      </main>
      <Footer />
    </div>
  )
}
