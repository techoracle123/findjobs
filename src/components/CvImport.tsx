import { useRef, useState } from 'react'
import { FileText, LoaderCircle, Upload } from 'lucide-react'
import { copy } from '../shared/copy'
import type { CvSuggestion } from '../shared/types'
import { suggestFromKeywords } from '../shared/cv-suggest'

interface CvImportProps {
  onApply: (suggestion: CvSuggestion) => void
}

/**
 * CV upload that never leaves the device: the file is read in the browser,
 * skills are matched against the catalogue locally, and nothing is sent to
 * a server or any third party. The user reviews the detected skills and
 * chooses whether to apply them.
 */
export function CvImport({ onApply }: CvImportProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [suggestion, setSuggestion] = useState<CvSuggestion | null>(null)
  const [applied, setApplied] = useState(false)
  const [fileName, setFileName] = useState<string | null>(null)

  const handleFile = async (file: File) => {
    setError(null)
    setSuggestion(null)
    setApplied(false)
    setBusy(true)
    setFileName(file.name)
    try {
      // Lazy-loaded so the PDF/DOCX parser stays out of the main bundle.
      const { extractCvText } = await import('../lib/cv/extract')
      const extracted = await extractCvText(file)
      setSuggestion(suggestFromKeywords(extracted.text))
    } catch {
      setError(copy('cv.unreadable'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="panel">
      <div className="panel__head">
        <h2 className="panel__title">Upload your CV</h2>
      </div>
      <div className="panel__body">
        <p className="panel__note">
          Add a PDF, DOCX or TXT CV and we will fill in your skills and preferences automatically.
          Your file is read on this device only — it is never uploaded or shared. Scanned-image PDFs
          are not supported.
        </p>
        <input
          ref={inputRef}
          type="file"
          aria-label="Upload your CV"
          accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
          className="visually-hidden"
          onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (file) void handleFile(file)
          }}
        />
        <div className="btnrow">
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => inputRef.current?.click()}
            disabled={busy}
          >
            {busy ? <LoaderCircle size={14} className="icon-spin" /> : <Upload size={14} />}
            {busy ? 'Reading your CV…' : 'Choose CV file'}
          </button>
          {fileName && !busy && (
            <span className="field__hint" style={{ alignSelf: 'center' }}>
              {fileName}
            </span>
          )}
        </div>

        {error && (
          <div className="banner banner--demo" role="alert">
            <FileText size={15} />
            <span>{error}</span>
          </div>
        )}

        {suggestion && (
          <div className="stack stack--sm">
            <div className="section__label" style={{ margin: 0 }}>
              Found in your CV
            </div>
            <p className="field__hint" style={{ margin: 0 }}>
              {suggestion.summary}
            </p>
            {suggestion.skills.length > 0 && (
              <div className="taglist">
                {suggestion.skills.map((skill) => (
                  <span className="tag tag--muted" key={skill}>
                    {skill}
                  </span>
                ))}
              </div>
            )}
            {suggestion.notes.length > 0 && (
              <ul style={{ margin: 0, paddingLeft: 16, color: 'var(--muted)', fontSize: 12 }}>
                {suggestion.notes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            )}
            <div className="btnrow">
              <button
                type="button"
                className="btn btn--primary btn--sm"
                disabled={applied}
                onClick={() => {
                  onApply(suggestion)
                  setApplied(true)
                }}
              >
                {applied ? 'Added to your profile' : 'Add to my profile'}
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  )
}
