import { useEffect, useState } from 'react'

interface CopyRow {
  id: string
  class: string
  legal: boolean
  renders: number
}

/**
 * Copy audit page (Prompt 19). Shows every registry string's id and class with
 * how often it rendered, so anything that "renders raw error text" is visible
 * as data. No raw server text ever appears here.
 */
export function AdminCopy() {
  const [rows, setRows] = useState<CopyRow[] | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    void (async () => {
      const response = await fetch('/api/admin/copy', { cache: 'no-store' })
      if (!response.ok) throw new Error('failed')
      const body = (await response.json()) as { entries: CopyRow[] }
      setRows(body.entries)
    })().catch(() => setError(true))
  }, [])

  return (
    <main className="wrap" id="main">
      <h1>Copy audit</h1>
      <p className="lede">
        Every status message the app can show, with its class. USER_ACTION messages are shown inline
        with a next step. DEGRADED messages are quiet. INTERNAL failures render nothing.
      </p>
      {error && (
        <p className="banner banner--demo" role="status">
          Loading failed. Retry.
        </p>
      )}
      {rows && (
        <table className="table">
          <thead>
            <tr>
              <th scope="col">Copy id</th>
              <th scope="col">Class</th>
              <th scope="col">Renders</th>
              <th scope="col">Note</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>
                  <code>{row.id}</code>
                </td>
                <td>{row.class}</td>
                <td>{row.renders}</td>
                <td>{row.legal ? 'legal text' : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  )
}
