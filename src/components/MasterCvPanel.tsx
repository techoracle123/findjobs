import { useEffect, useRef, useState } from 'react'
import { Download, FileText, LoaderCircle, ShieldCheck, Trash2, Upload } from 'lucide-react'
import { analyseSavedMasterCv, deleteMasterCv, fetchMasterCv, saveMasterCv } from '../lib/api'
import type { MasterCv, ProTrialState } from '../shared/types'
import type { ImportedCv } from './CvImport'
import { PRO_FREE_FOR_ALL } from '../shared/access'

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
  if (!report) {
    const basic = cv.basicSummary
    return [
      'FJ saved CV summary',
      `CV: ${cv.fileName}`,
      `Saved: ${fmtDateTime(basic.generatedAt)}`,
      '',
      basic.summary,
      '',
      `Words: ${basic.wordCount}`,
      `About pages: ${basic.estimatedPages}`,
      `Skills found: ${basic.detectedSkills.join(', ') || 'None from the FJ skills list'}`,
      `Sections found: ${basic.sectionsFound.join(', ') || 'None clearly labelled'}`,
      '',
      'This is the free saved-CV summary. It does not include the full Pro CV check.',
    ].join('\n')
  }
  const lines = [
    'FJ CV check',
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
      `${role.label}: ${role.matchingJobs} matching adverts`,
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
  const [fullAccess, setFullAccess] = useState(proEnabled)
  const [paidAccess, setPaidAccess] = useState(false)

  useEffect(() => {
    setFullAccess(proEnabled)
  }, [proEnabled])

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
      .then((body) => {
        if (!active) return
        setCv(body.cv)
        setFullAccess(body.canFullAnalysis ?? !body.locked)
        setPaidAccess(body.paid)
      })
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
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : ''
      setError(
        message.startsWith('FJ:')
          ? message.slice(3)
          : 'That file could not be read. Use a text-readable PDF or DOCX, or paste the CV text below.',
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
      setFullAccess(body.canFullAnalysis ?? !body.locked)
      setPaidAccess(body.paid)
      setSavedText(null)
      setPending(null)
      setPasted('')
      setNotice(
        body.cv.report
          ? 'Your full CV check is ready. We saved the readable text and report in your account.'
          : PRO_FREE_FOR_ALL
            ? 'Your CV text is saved. Run the full check when you are ready.'
            : body.canFullAnalysis
              ? 'Your CV text is saved. The full check in your trial was already used, so no new report was made.'
              : 'Your CV text is saved free. Use the trial or Pro when you want the full check.',
      )
      // The saved CV is already visible. Refreshing trial counters in the
      // background must not keep the button busy or turn a successful save
      // into an error if that later account read is slow.
      setBusy(false)
      void Promise.resolve(onRefresh()).catch(() => undefined)
    } catch {
      setError('We could not save the CV. Make sure the text can be read and try again.')
    } finally {
      setBusy(false)
    }
  }

  const analyseSaved = async () => {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const body = await analyseSavedMasterCv()
      setCv(body.cv)
      setFullAccess(body.canFullAnalysis ?? !body.locked)
      setPaidAccess(body.paid)
      setSavedText(null)
      setNotice('Your full CV check is ready.')
      setBusy(false)
      void Promise.resolve(onRefresh()).catch(() => undefined)
    } catch {
      setError(
        trial.status === 'active' && trial.cvAnalysesUsed >= trial.limits.cvAnalyses
          ? 'You have used the one full CV check in your free trial. Your saved CV text is still here.'
          : 'We could not run the full CV check. Please try again.',
      )
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    if (!window.confirm('Delete your saved CV text and report from FJ?')) return
    setBusy(true)
    try {
      await deleteMasterCv()
      setCv(null)
      setSavedText(null)
      setNotice('Your saved CV text and report have been deleted.')
    } catch {
      setError('We could not delete your saved CV. Please try again.')
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
      setError('We could not load the saved CV text. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  const trialUsed = trial.cvAnalysesUsed >= trial.limits.cvAnalyses
  const trialCheckUsed = !PRO_FREE_FOR_ALL && trial.status === 'active' && trialUsed && !paidAccess
  const canRunFull = fullAccess && !trialCheckUsed
  const replacementText = pending?.text ?? pasted
  const replacementTooLong = replacementText.length > 60_000
  const hasReplacement = Boolean(pending || pasted.trim())
  const savedSummary = cv?.report ?? cv?.basicSummary ?? null
  const fullReport = cv?.report ?? null
  const saveLabel = busy
    ? 'Saving...'
    : !cv && canRunFull
      ? 'Check my CV'
      : cv && canRunFull
        ? 'Save and check this CV'
        : 'Save CV text free'

  return (
    <section className="panel master-cv-panel" aria-labelledby="master-cv-heading">
      <div className="panel__head panel-head-row">
        <div>
          <p className="eyebrow">
            {PRO_FREE_FOR_ALL
              ? 'Free early access · Full CV check included'
              : 'Free save · Full check with trial or Pro'}
          </p>
          <h2 className="panel__title" id="master-cv-heading">
            Your saved CV
          </h2>
        </div>
        <ShieldCheck size={22} aria-hidden="true" />
      </div>
      <div className="panel__body stack">
        <p className="panel__note">
          {PRO_FREE_FOR_ALL
            ? 'Save the readable text from your CV and run a full check that shows what to fix first. Both are included during free early access.'
            : 'Save the readable text from your CV free. A trial or Pro plan can also make a full check that shows what to fix first.'}
        </p>
        <p className="field__hint">
          Your browser reads the file. With your permission, FJ saves only the text and a short
          summary. We do not keep the PDF, DOCX or TXT file, and we do not send your CV to any
          company.
        </p>

        {loading ? <p role="status">Loading your saved CV...</p> : null}

        {!fullAccess ? (
          <div className="locked-box compact">
            <h3>You can save your CV now</h3>
            <p>
              Saving the readable text is free. The full check needs the 3-day trial or Pro. If you
              already have a full report, it stays readable below.
            </p>
            <button className="btn btn-primary" type="button" onClick={onOpenPlan}>
              {trial.status === 'not_started' ? 'Trial or buy Pro' : 'Buy Pro'}
            </button>
          </div>
        ) : null}

        {signedIn ? (
          <div className="master-cv-upload stack stack--sm">
            <input
              ref={fileRef}
              className="visually-hidden"
              type="file"
              aria-label="Choose CV to check"
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
                disabled={busy}
                onClick={() => fileRef.current?.click()}
              >
                {busy ? <LoaderCircle size={15} className="icon-spin" /> : <Upload size={15} />}
                {cv ? 'Choose another CV' : 'Choose CV'}
              </button>
              {pending ? (
                <span className="field__hint">
                  Ready: {pending.fileName} ({pending.text.trim().split(/\s+/).length} words,{' '}
                  {pending.text.length.toLocaleString('en-NG')} characters read)
                </span>
              ) : null}
            </div>
            {pending ? (
              <details className="cv-details">
                <summary>Preview the text FJ read</summary>
                <label className="field">
                  Text read from {pending.fileName}
                  <textarea rows={8} readOnly value={pending.text} />
                </label>
                <p className="field__hint">
                  Check that names, dates, skills and job titles look right before you save it.
                </p>
              </details>
            ) : null}
            <details>
              <summary>Paste CV text instead</summary>
              <label className="field">
                CV text
                <textarea
                  rows={8}
                  value={pasted}
                  onChange={(event) => setPasted(event.target.value)}
                  placeholder="Paste all the words from your CV"
                />
              </label>
            </details>
            <label className="checkbox-field">
              <input
                type="checkbox"
                checked={consent}
                onChange={(event) => setConsent(event.target.checked)}
              />{' '}
              I agree that FJ can save the text from this CV and a short summary in my account. If a
              full check runs, FJ can also save that report. I know FJ will not keep the file. I can
              delete the saved text at any time.
            </label>
            {cv && hasReplacement ? (
              <p className="field__hint" role="status">
                This will replace your saved CV text.
                {cv.report && !canRunFull
                  ? ' The old full report will also be removed because no new full check will run. Download it first if you need it.'
                  : ''}
              </p>
            ) : null}
            {replacementTooLong ? (
              <p className="banner banner--demo" role="alert">
                This CV has more than 60,000 characters of readable text. Remove repeated pages or
                old attachments before saving. FJ will not cut the text without telling you.
              </p>
            ) : null}
            {!PRO_FREE_FOR_ALL && trial.status === 'active' && !paidAccess ? (
              <p className="field__hint" role="status">
                {trialCheckUsed
                  ? 'Your one trial CV check has been used. You can still save or replace CV text free.'
                  : `Trial: ${Math.max(0, trial.limits.cvAnalyses - trial.cvAnalysesUsed)} full CV check left. Checking the same text again does not use another one.`}
              </p>
            ) : null}
            <button
              className="btn btn--primary"
              type="button"
              disabled={busy || !consent || replacementTooLong || !hasReplacement}
              onClick={() => void save()}
            >
              {saveLabel}
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

        {cv && savedSummary ? (
          <div className="cv-report stack">
            <div className="cv-report-head">
              <div>
                <h3>
                  <FileText size={18} aria-hidden="true" /> {cv.fileName}
                </h3>
                <p className="muted">
                  {fullReport ? 'Checked' : 'Saved'} {fmtDateTime(savedSummary.generatedAt)} ·{' '}
                  {savedSummary.wordCount} words · about {savedSummary.estimatedPages} page
                  {savedSummary.estimatedPages === 1 ? '' : 's'}
                </p>
              </div>
              <span className="status-pill status-open">
                {fullReport ? 'Full check saved' : 'CV text saved'}
              </span>
            </div>
            <p className="cv-overall">{savedSummary.summary}</p>

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
                onClick={() =>
                  downloadText(
                    fullReport ? 'fj-cv-check.txt' : 'fj-cv-summary.txt',
                    reportAsText(cv),
                  )
                }
              >
                <Download size={14} /> {fullReport ? 'Download report' : 'Download summary'}
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

            {!fullReport ? (
              <div className="cv-basic-summary stack stack--sm">
                <h3>What FJ found</h3>
                <p>
                  <strong>Skills:</strong>{' '}
                  {cv.basicSummary.detectedSkills.length
                    ? cv.basicSummary.detectedSkills.slice(0, 10).join(', ')
                    : 'No skills from the FJ list yet'}
                </p>
                <p>
                  <strong>Sections found:</strong>{' '}
                  {cv.basicSummary.sectionsFound.length
                    ? cv.basicSummary.sectionsFound.join(', ')
                    : 'No clear section headings'}
                </p>
                {canRunFull ? (
                  <>
                    <p>
                      Your text is saved. Run the full check when you are ready. You do not need to
                      upload the file again.
                    </p>
                    <button
                      className="btn btn--primary"
                      type="button"
                      disabled={busy}
                      onClick={() => void analyseSaved()}
                    >
                      {busy ? 'Checking...' : 'Run full CV check'}
                    </button>
                  </>
                ) : (
                  <>
                    <p>
                      {trialCheckUsed
                        ? 'Your one trial full check has been used. This saved text can be checked fully with Pro.'
                        : 'The full check shows what to fix first, weak bullets and missing evidence. It needs the trial or Pro.'}
                    </p>
                    <button className="btn btn-primary" type="button" onClick={onOpenPlan}>
                      {trial.status === 'not_started' ? 'Trial or buy Pro' : 'Buy Pro'}
                    </button>
                  </>
                )}
              </div>
            ) : null}

            {fullReport ? (
              <>
                <div>
                  <h3>Fix these first</h3>
                  <ol className="numbered-list">
                    {fullReport.priorityFixes.map((fix) => (
                      <li key={fix}>{fix}</li>
                    ))}
                  </ol>
                </div>

                <div>
                  <h3>What looks good</h3>
                  <ul className="plain-list">
                    {fullReport.strengths.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>

                <details className="cv-details">
                  <summary>Section by section detail</summary>
                  <div className="cv-section-grid">
                    {fullReport.sections.map((section) => (
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
                </details>

                {fullReport.weakBullets.length ? (
                  <details className="cv-details">
                    <summary>Bullets that need evidence ({fullReport.weakBullets.length})</summary>
                    {fullReport.weakBullets.map((bullet) => (
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
                  </details>
                ) : null}

                <details className="cv-details">
                  <summary>Role evidence, missing evidence and dates</summary>
                  <div>
                    <h3>Evidence for roles you want</h3>
                    {fullReport.targetRoles.map((role) => {
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

                  {fullReport.missingEvidenceQuestions.length ? (
                    <div>
                      <h3>Evidence only you can add</h3>
                      <ul className="plain-list">
                        {fullReport.missingEvidenceQuestions.map((question) => (
                          <li key={question}>{question}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  <div>
                    <h3>Dates and early-career evidence</h3>
                    <ul className="plain-list">
                      {fullReport.timeline.notes.map((note) => (
                        <li key={note}>{note}</li>
                      ))}
                      {fullReport.earlyCareerSignals.map((signal) => (
                        <li key={signal}>{signal}</li>
                      ))}
                    </ul>
                  </div>
                </details>
              </>
            ) : null}

            {fullReport ? (
              <p className="field__hint">
                FJ has not added any experience, employer, qualification, date or result. Replace
                every bracket with true evidence from your own work.
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  )
}
