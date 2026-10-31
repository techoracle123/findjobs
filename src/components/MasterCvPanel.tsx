import { useEffect, useRef, useState } from 'react'
import { Download, FileText, LoaderCircle, ShieldCheck, Trash2, Upload } from 'lucide-react'
import { deleteMasterCv, fetchMasterCv, saveMasterCv } from '../lib/api'
import type { MasterCv, ProTrialState } from '../shared/types'
import type { ImportedCv } from './CvImport'

interface MasterCvPanelProps {
  signedIn: boolean
  proEnabled: boolean
  trial: ProTrialState
  importedCv: ImportedCv | null
  onOpenPlan: () => void
  onRefresh: () => Promise<void> | void
}

function fmtDateTime(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleString('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
}

function downloadText(filename: string, text: string) {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000)
}

function reportAsText(cv: MasterCv): string {
  const report = cv.report
  const lines = [
    'FJ detailed CV analysis',
    `CV: ${cv.fileName}`,
    `Checked: ${fmtDateTime(report.generatedAt)}`,
    '',
    report.summary,
    '',
    'PRIORITY FIXES',
    ...report.priorityFixes.map((fix, index) => `${index + 1}. ${fix}`),
    '',
    'STRENGTHS',
    ...report.strengths.map((item) => `- ${item}`),
    '',
    'SECTION BY SECTION',
  ]
  for (const section of report.sections) {
    lines.push('', `${section.title}: ${section.rating}`, section.summary)
    if (section.evidence.length)
      lines.push('Evidence:', ...section.evidence.map((item) => `- ${item}`))
    if (section.actions.length)
      lines.push('Actions:', ...section.actions.map((item) => `- ${item}`))
  }
  lines.push('', 'BULLETS TO IMPROVE')
  for (const bullet of report.weakBullets) {
    lines.push('', `Original: ${bullet.original}`, `Try: ${bullet.suggestion}`, bullet.reason)
  }
  lines.push('', 'EVIDENCE QUESTIONS')
  lines.push(...report.missingEvidenceQuestions.map((item) => `- ${item}`))
  lines.push('', 'ROLE EVIDENCE FROM CURRENT ADVERTS')
  for (const role of report.targetRoles) {
    lines.push(
      '',
      `${role.label} — ${role.matchingJobs} matching adverts`,
      `Evidence found: ${role.matchedSkills.join(', ') || 'None yet'}`,
      `Missing: ${role.missingSkills.join(', ') || 'None in the main list'}`,
    )
  }
  lines.push('', 'TIMELINE')
  lines.push(...report.timeline.notes.map((item) => `- ${item}`))
  lines.push(
    '',
    'FJ has not added any experience, employer, qualification, date or result. Replace every bracket with true evidence from your own work.',
  )
  return lines.join('\n')
}

export function MasterCvPanel({
  signedIn,
  proEnabled,
  trial,
  importedCv,
  onOpenPlan,
  onRefresh,
}: MasterCvPanelProps) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [cv, setCv] = useState<MasterCv | null>(null)
  const [pending, setPending] = useState<ImportedCv | null>(null)
  const [pasted, setPasted] = useState('')
  const [consent, setConsent] = useState(false)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [savedText, setSavedText] = useState<string | null>(null)

  useEffect(() => {
    if (importedCv) setPending(importedCv)
  }, [importedCv])

  useEffect(() => {
    if (!signedIn) {
      setCv(null)
      return
    }
    let active = true
    setLoading(true)
    void fetchMasterCv(false)
      .then((body) => active && setCv(body.cv))
      .catch(() => active && setCv(null))
      .finally(() => active && setLoading(false))
    return () => {
      active = false
    }
  }, [signedIn])

  const handleFile = async (file: File) => {
    setError('')
    setNotice('')
    setBusy(true)
    try {
      const { extractCvText } = await import('../lib/cv/extract')
      const extracted = await extractCvText(file)
      setPending({
        text: extracted.text,
        fileName: file.name,
        fileType: file.type || extracted.kind,
      })
    } catch {
      setError(
        'That file could not be read. Use a text-readable PDF or DOCX, or paste the CV text below.',
      )
    } finally {
      setBusy(false)
    }
  }

  const save = async () => {
    const source =
      pending ??
      (pasted.trim()
        ? { text: pasted.trim(), fileName: 'Pasted CV', fileType: 'text/plain' }
        : null)
    if (!source) {
      setError('Choose a readable CV file or paste your CV text first.')
      return
    }
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const body = await saveMasterCv({ ...source, consent })
      setCv(body.cv)
      setSavedText(null)
      setNotice(
        'Your detailed CV analysis is ready. The readable text is saved only in your FJ account.',
      )
      // The report is already saved and visible. Refreshing trial counters in
      // the background must not keep the button saying "Analysing…" or turn a
      // successful save into an error if that later account read is slow.
      setBusy(false)
      void Promise.resolve(onRefresh()).catch(() => undefined)
    } catch {
      setError(
        trial.status === 'active' && trial.cvAnalysesUsed >= trial.limits.cvAnalyses
          ? 'You have used the one full CV analysis in your free trial.'
          : 'The CV could not be analysed just now. Check that the text is readable and try again.',
      )
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    if (!window.confirm('Delete your saved CV text and its analysis report from FJ?')) return
    setBusy(true)
    try {
      await deleteMasterCv()
      setCv(null)
      setSavedText(null)
      setNotice('Your saved CV text and report have been deleted.')
    } catch {
      setError('Your saved CV could not be deleted just now. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  const showSavedText = async () => {
    if (savedText !== null) {
      setSavedText(null)
      return
    }
    setBusy(true)
    try {
      const body = await fetchMasterCv(true)
      setSavedText(body.cv?.text ?? '')
    } catch {
      setError('The saved CV text could not be loaded just now.')
    } finally {
      setBusy(false)
    }
  }

  const trialUsed = trial.cvAnalysesUsed >= trial.limits.cvAnalyses
  const canAnalyse = proEnabled && !(trial.status === 'active' && trialUsed && !cv)

  return (
    <section className="panel master-cv-panel" aria-labelledby="master-cv-heading">
      <div className="panel__head panel-head-row">
        <div>
          <p className="eyebrow">Pro CV centre</p>
          <h2 className="panel__title" id="master-cv-heading">
            Your saved master CV
          </h2>
        </div>
        <ShieldCheck size={22} aria-hidden="true" />
      </div>
      <div className="panel__body stack">
        <p className="panel__note">
          A detailed review of the words in your CV: what is clear, what is missing, which bullets
          need proof, and which skills real adverts keep asking for.
        </p>
        <p className="field__hint">
          Free import stays on your device. This Pro step is separate: with your permission, FJ
          saves the readable text and report so job checks can use them. The original PDF or DOCX
          file is not kept. Nobody else receives your CV from this feature.
        </p>

        {loading ? <p role="status">Loading your saved CV…</p> : null}

        {!proEnabled && !cv ? (
          <div className="locked-box">
            <h3>
              {trial.status === 'not_started'
                ? 'Start with one full analysis in the free trial'
                : 'Detailed CV analysis is part of Pro'}
            </h3>
            <p>
              The 3-day trial includes one full CV analysis. It stays in your account after the
              trial ends. Basic CV import above remains free.
            </p>
            <button className="btn btn-primary" type="button" onClick={onOpenPlan}>
              {trial.status === 'not_started' ? 'Start the 3-day free trial' : 'See Pro plans'}
            </button>
          </div>
        ) : null}

        {proEnabled ? (
          <div className="master-cv-upload stack stack--sm">
            <input
              ref={fileRef}
              className="visually-hidden"
              type="file"
              aria-label="Choose CV for detailed analysis"
              accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
              onChange={(event) => {
                const file = event.target.files?.[0]
                event.target.value = ''
                if (file) void handleFile(file)
              }}
            />
            <div className="btnrow">
              <button
                className="btn btn--primary"
                type="button"
                disabled={busy || !canAnalyse}
                onClick={() => fileRef.current?.click()}
              >
                {busy ? <LoaderCircle size={15} className="icon-spin" /> : <Upload size={15} />}
                {cv ? 'Choose a replacement CV' : 'Choose CV for analysis'}
              </button>
              {pending ? (
                <span className="field__hint">
                  Ready: {pending.fileName} ({pending.text.trim().split(/\s+/).length} words read)
                </span>
              ) : null}
            </div>
            <details>
              <summary>Paste CV text instead</summary>
              <label className="field">
                CV text
                <textarea
                  rows={8}
                  value={pasted}
                  onChange={(event) => setPasted(event.target.value)}
                  placeholder="Paste the complete words from your CV"
                />
              </label>
            </details>
            <label className="checkbox-field">
              <input
                type="checkbox"
                checked={consent}
                onChange={(event) => setConsent(event.target.checked)}
              />{' '}
              I agree that FJ may save the readable text from this CV and the analysis report in my
              account. I understand the original file is not kept and I can delete the saved text at
              any time.
            </label>
            {trial.status === 'active' ? (
              <p className="field__hint" role="status">
                Trial: {Math.max(0, trial.limits.cvAnalyses - trial.cvAnalysesUsed)} full CV
                analysis remaining. Re-checking the exact same text does not use another one.
              </p>
            ) : null}
            <button
              className="btn btn--primary"
              type="button"
              disabled={busy || !consent || !canAnalyse || (!pending && !pasted.trim())}
              onClick={() => void save()}
            >
              {busy ? 'Analysing…' : cv ? 'Analyse replacement CV' : 'Analyse my CV'}
            </button>
          </div>
        ) : null}

        {error ? (
          <p className="banner banner--demo" role="alert">
            {error}
          </p>
        ) : null}
        {notice ? (
          <p className="form-notice" role="status">
            {notice}
          </p>
        ) : null}

        {cv ? (
          <div className="cv-report stack">
            <div className="cv-report-head">
              <div>
                <h3>
                  <FileText size={18} aria-hidden="true" /> {cv.fileName}
                </h3>
                <p className="muted">
                  Saved text analysed {new Date(cv.report.generatedAt).toLocaleString()} ·{' '}
                  {cv.report.wordCount} words · about {cv.report.estimatedPages} page
                  {cv.report.estimatedPages === 1 ? '' : 's'}
                </p>
              </div>
              <span className="status-pill status-open">Saved</span>
            </div>
            <p className="cv-overall">{cv.report.summary}</p>

            <div className="btnrow" aria-label="Saved CV actions">
              <button
                className="btn btn--sm"
                type="button"
                disabled={busy}
                onClick={() => void showSavedText()}
              >
                {savedText === null ? 'View saved text' : 'Hide saved text'}
              </button>
              <button
                className="btn btn--sm"
                type="button"
                onClick={() => downloadText('fj-cv-analysis.txt', reportAsText(cv))}
              >
                <Download size={14} /> Download report
              </button>
              <button
                className="btn btn--sm"
                type="button"
                disabled={busy}
                onClick={() => {
                  void fetchMasterCv(true).then((body) => {
                    if (body.cv?.text) downloadText('fj-saved-cv-text.txt', body.cv.text)
                  })
                }}
              >
                <Download size={14} /> Download saved text
              </button>
              <button
                className="btn btn--sm btn-danger"
                type="button"
                disabled={busy}
                onClick={() => void remove()}
              >
                <Trash2 size={14} /> Delete saved CV
              </button>
            </div>

            {savedText !== null ? (
              <label className="field">
                Saved readable CV text
                <textarea rows={12} readOnly value={savedText} />
              </label>
            ) : null}

            <div>
              <h3>Fix these first</h3>
              <ol className="numbered-list">
                {cv.report.priorityFixes.map((fix) => (
                  <li key={fix}>{fix}</li>
                ))}
              </ol>
            </div>

            <div>
              <h3>What is already working</h3>
              <ul className="plain-list">
                {cv.report.strengths.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>

            <div className="cv-section-grid">
              {cv.report.sections.map((section) => (
                <article key={section.title}>
                  <div className="inline-head">
                    <h3>{section.title}</h3>
                    <span
                      className={`status-pill ${section.rating === 'strong' ? 'status-open' : ''}`}
                    >
                      {section.rating === 'needs-work' ? 'Needs work' : section.rating}
                    </span>
                  </div>
                  <p>{section.summary}</p>
                  {section.evidence.length ? (
                    <>
                      <h4>Evidence found</h4>
                      <ul className="plain-list">
                        {section.evidence.map((line) => (
                          <li key={line}>{line}</li>
                        ))}
                      </ul>
                    </>
                  ) : null}
                  {section.actions.length ? (
                    <>
                      <h4>What to do</h4>
                      <ul className="plain-list">
                        {section.actions.map((line) => (
                          <li key={line}>{line}</li>
                        ))}
                      </ul>
                    </>
                  ) : null}
                </article>
              ))}
            </div>

            {cv.report.weakBullets.length ? (
              <div>
                <h3>Bullets that need evidence</h3>
                {cv.report.weakBullets.map((bullet) => (
                  <article className="bullet-fix" key={bullet.original}>
                    <p>
                      <strong>Now:</strong> {bullet.original}
                    </p>
                    <p>
                      <strong>Starting point:</strong> {bullet.suggestion}
                    </p>
                    <small>{bullet.reason}</small>
                  </article>
                ))}
              </div>
            ) : null}

            <div>
              <h3>Evidence for roles you want</h3>
              {cv.report.targetRoles.map((role) => {
                const total = role.matchedSkills.length + role.missingSkills.length
                const pct = total ? Math.round((role.matchedSkills.length / total) * 100) : 0
                return (
                  <article className="role-evidence" key={role.roleFamily}>
                    <div className="inline-head">
                      <h4>{role.label}</h4>
                      <span className="status-pill">
                        {pct}% of main skills · {role.matchingJobs} adverts
                      </span>
                    </div>
                    <p>
                      <strong>Found:</strong>{' '}
                      {role.matchedSkills.length
                        ? role.matchedSkills.join(', ')
                        : 'No main skill evidence yet'}
                    </p>
                    <p>
                      <strong>Missing:</strong>{' '}
                      {role.missingSkills.length
                        ? role.missingSkills.join(', ')
                        : 'No major gap in this sample'}
                    </p>
                  </article>
                )
              })}
            </div>

            {cv.report.missingEvidenceQuestions.length ? (
              <div>
                <h3>Evidence only you can add</h3>
                <ul className="plain-list">
                  {cv.report.missingEvidenceQuestions.map((question) => (
                    <li key={question}>{question}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div>
              <h3>Dates and early-career evidence</h3>
              <ul className="plain-list">
                {cv.report.timeline.notes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
                {cv.report.earlyCareerSignals.map((signal) => (
                  <li key={signal}>{signal}</li>
                ))}
              </ul>
            </div>

            <p className="field__hint">
              FJ has not added any experience, employer, qualification, date or result. Replace
              every bracket with true evidence from your own work.
            </p>
          </div>
        ) : null}
      </div>
    </section>
  )
}
