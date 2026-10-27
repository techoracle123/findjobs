import { useRef, useState } from 'react'
import { FileText, LoaderCircle, Sparkles, Upload } from 'lucide-react'
import { copy } from '../shared/copy'
import type { CvSuggestion } from '../shared/types'
import { suggestFromCv } from '../lib/api'

interface CvImportProps {
  onApply: (suggestion: CvSuggestion) => void
}

/**
 * Parses a CV in the browser and asks the API for profile suggestions. Only
 * the extracted text is sent; the file itself never leaves the device.
 */
export function CvImport({ onApply }: CvImportProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [stage, setStage] = useState<'idle' | 'extracting' | 'suggesting'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [suggestion, setSuggestion] = useState<CvSuggestion | null>(null)
  const [fileName, setFileName] = useState<string | null>(null)

  const [acknowledged, setAcknowledged] = useState(false)

  const handleFile = async (file: File) => {
    if (!acknowledged) {
      setError(copy('cv.needsNotice'))
      return
    }
    setError(null)
    setSuggestion(null)
    setBusy(true)
    setStage('extracting')
    setFileName(file.name)

    try {
      // Lazy-loaded so the PDF/DOCX parser stays out of the main bundle.
      const { extractCvText } = await import('../lib/cv/extract')
      const extracted = await extractCvText(file)

      setStage('suggesting')
      const result = await suggestFromCv(extracted.text)
      setSuggestion(result)
    } catch (cause) {
      setError(copy('cv.unreadable'))
    } finally {
      setBusy(false)
      setStage('idle')
    }
  }

  return (
    <section className="panel">
      <div className="panel__head">
        <h2 className="panel__title">Import a CV</h2>
      </div>
      <div className="panel__body">
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
        <label className="cv-notice">
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={(event) => setAcknowledged(event.target.checked)}
          />
          <span>
            I understand that the text I upload is sent to FJ’s AI provider, OpenRouter, to generate
            suggestions. The file itself stays on my device. See <a href="/privacy">Privacy</a>.
          </span>
        </label>
        <div className="btnrow">
          <button
            type="button"
            className="btn"
            onClick={() => inputRef.current?.click()}
            disabled={busy || !acknowledged}
          >
            {busy ? <LoaderCircle size={14} className="icon-spin" /> : <Upload size={14} />}
            {busy ? 'Reading…' : 'Choose file'}
          </button>
          {fileName && !busy && (
            <span className="field__hint" style={{ alignSelf: 'center' }}>
              {fileName}
            </span>
          )}
        </div>

        <p className="panel__note">
          Choosing a PDF, DOCX or TXT file sends its extracted text to our server and, when enabled,
          OpenRouter for profile suggestions. Remove personal details first. The file itself stays
          on your device. Scanned PDFs are not supported.
        </p>

        {busy && (
          <p className="field__hint">
            {stage === 'extracting' ? 'Extracting text in the browser…' : 'Deriving suggestions…'}
          </p>
        )}

        {error && (
          <div className="banner banner--demo">
            <FileText size={15} />
            <span>{error}</span>
          </div>
        )}

        {suggestion && (
          <div className="stack stack--sm">
            <div className="section__label" style={{ margin: 0 }}>
              Suggestions
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
                onClick={() => onApply(suggestion)}
              >
                <Sparkles size={13} />
                Apply to profile
              </button>
              <span className="field__hint" style={{ alignSelf: 'center' }}>
                {suggestion.provider === 'keyword-fallback'
                  ? 'Keyword-based suggestions'
                  : 'AI-generated suggestions'}
              </span>
            </div>
          </div>
        )}
      </div>
    </section>
  )
}
