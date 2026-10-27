import { ChevronLeft, ChevronRight } from 'lucide-react'

interface PaginationProps {
  page: number
  pageCount: number
  onChange: (page: number) => void
}

/** Real pagination: 20 listings per page, page number lives in the URL. */
export function Pagination({ page, pageCount, onChange }: PaginationProps) {
  if (pageCount <= 1) return null
  const window: number[] = []
  for (
    let candidate = Math.max(1, page - 2);
    candidate <= Math.min(pageCount, page + 2);
    candidate += 1
  )
    window.push(candidate)
  return (
    <nav className="pagination" aria-label="Job pages">
      <button
        type="button"
        className="btn btn--ghost btn--sm"
        disabled={page <= 1}
        onClick={() => onChange(page - 1)}
        aria-label="Previous page"
      >
        <ChevronLeft size={15} /> Prev
      </button>
      {window[0] > 1 && <span className="pagination__gap">…</span>}
      {window.map((number) => (
        <button
          key={number}
          type="button"
          className={`btn btn--sm ${number === page ? 'btn--primary' : 'btn--ghost'}`}
          aria-current={number === page ? 'page' : undefined}
          onClick={() => onChange(number)}
        >
          {number}
        </button>
      ))}
      {window[window.length - 1] < pageCount && <span className="pagination__gap">…</span>}
      <button
        type="button"
        className="btn btn--ghost btn--sm"
        disabled={page >= pageCount}
        onClick={() => onChange(page + 1)}
        aria-label="Next page"
      >
        Next <ChevronRight size={15} />
      </button>
    </nav>
  )
}
