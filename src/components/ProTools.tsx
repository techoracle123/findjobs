import { useEffect, useState } from 'react'
import { Check, Clipboard, Download, Lock, ShieldAlert } from 'lucide-react'
import type {
  AdvertCheckResult,
  ApplicationAnswers,
  CvCheckResult,
  InterviewPrep,
  Job,
  PreparedApplication,
  ProTrialState,
  SalaryGuideResult,
} from '../shared/types'
import {
  ApiError,
  checkCvForJob,
  createPreparedApplication,
  fetchApplicationAnswers,
  fetchInterviewPrep,
  fetchPreparedApplication,
  fetchSalaryGuide,
  runJobAdvertCheck,
  saveApplicationAnswers,
} from '../lib/api'
import { formatRange, PERIOD_LABELS } from '../shared/format'
import { AdvertCheckResultView } from './AdvertCheckPanel'

const EMPTY_ANSWERS: ApplicationAnswers = {
  fullName: '',
  phone: '',
  location: '',
  portfolioUrl: '',
  linkedinUrl: '',
  summary: '',
  whyFit: '',
  achievement: '',
  availability: '',
  salaryExpectation: '',
  workPermission: '',
}

const ANSWER_FIELDS: Array<{
  key: keyof ApplicationAnswers
  label: string
  textarea?: boolean
  placeholder: string
}> = [
  { key: 'fullName', label: 'Full name', placeholder: 'Your full name' },
  { key: 'phone', label: 'Phone', placeholder: 'Phone number' },
  { key: 'location', label: 'Where you live', placeholder: 'City and country' },
  { key: 'portfolioUrl', label: 'Portfolio link', placeholder: 'https://...' },
  { key: 'linkedinUrl', label: 'Profile link', placeholder: 'https://...' },
  {
    key: 'summary',
    label: 'Short summary of your experience',
    textarea: true,
    placeholder: 'Your experience, strongest work and one result you can prove.',
  },
  {
    key: 'whyFit',
    label: 'Why you fit roles like this',
    textarea: true,
    placeholder: 'The experience you bring and how you work.',
  },
  {
    key: 'achievement',
    label: 'One relevant result',
    textarea: true,
    placeholder: 'The task, what you did, and the result. Use numbers only when they are true.',
  },
  {
    key: 'availability',
    label: 'When you can start',
    placeholder: 'Immediately, or your notice period',
  },
  {
    key: 'salaryExpectation',
    label: 'Salary expectation',
    placeholder: 'Your honest range, if you want to state one',
  },
  {
    key: 'workPermission',
    label: 'Work permission and location position',
    textarea: true,
    placeholder: 'Where you can work, whether you can travel, and any permit position.',
  },
]

function money(value: number | null, currency: string | null): string {
  return value === null || !currency ? '' : formatRange(value, value, currency)
}

function packText(prepared: PreparedApplication): string {
  return [
    `Subject: ${prepared.subject}`,
    '',
    'COVER LETTER',
    prepared.coverLetter,
    '',
    'APPLICATION ANSWERS',
    ...prepared.answers.flatMap((item) => ['', item.question, item.answer]),
    '',

    'BEFORE YOU SEND',
    ...prepared.checklist.map((item) => `- ${item}`),
  ].join('\n')
}

function downloadPack(prepared: PreparedApplication) {
  const blob = new Blob([packText(prepared)], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = 'fj-application.txt'
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000)
}

function PreparedView({
  prepared,
  copied,
  onCopy,
}: {
  prepared: PreparedApplication
  copied: string | null
  onCopy: (label: string, text: string) => Promise<void>
}) {
  return (
    <div className="stack">
      {prepared.missingInfo.length > 0 ? (
        <p className="banner banner--demo" role="status">
          Before sending, add: {prepared.missingInfo.join(', ')}.
        </p>
      ) : null}
      <label className="field">
        Subject
        <input className="input" readOnly value={prepared.subject} />
      </label>
      <label className="field">
        Cover letter
        <textarea className="textarea" readOnly rows={14} value={prepared.coverLetter} />
      </label>
      <div className="btnrow">
        <button
          className="btn"
          type="button"
          onClick={() => void onCopy('cover', prepared.coverLetter)}
        >
          {copied === 'cover' ? <Check size={14} /> : <Clipboard size={14} />} Copy cover letter
        </button>
        <button className="btn" type="button" onClick={() => downloadPack(prepared)}>
          <Download size={14} /> Download all
        </button>
        {prepared.mailtoUrl ? (
          <a className="btn" href={prepared.mailtoUrl}>
            Open ready-to-send email
          </a>
        ) : null}
      </div>
      {prepared.answers.map((item) => (
        <div className="stack stack--sm" key={item.question}>
          <label className="field">
            {item.question}
            <textarea className="textarea" readOnly rows={4} value={item.answer} />
          </label>
          <button
            className="btn btn--ghost btn--sm"
            type="button"
            onClick={() => void onCopy(item.question, item.answer)}
          >
            {copied === item.question ? <Check size={13} /> : <Clipboard size={13} />} Copy answer
          </button>
        </div>
      ))}
      <h4>Before you send</h4>
      <ul className="plain-list">
        {prepared.checklist.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  )
}

function serverMessage(error: unknown): string | null {
  if (!(error instanceof ApiError)) return null
  try {
    const parsed = JSON.parse(error.body) as { message?: unknown }
    return typeof parsed.message === 'string' ? parsed.message : null
  } catch {
    return null
  }
}

interface ProToolsProps {
  job: Job
  proEnabled: boolean
  trial?: ProTrialState
  onRefresh?: () => Promise<void> | void
}

export function ProTools({ job, proEnabled, trial, onRefresh }: ProToolsProps) {
  const [answers, setAnswers] = useState<ApplicationAnswers>(EMPTY_ANSWERS)
  const [prepared, setPrepared] = useState<PreparedApplication | null>(null)
  const [cvText, setCvText] = useState('')
  const [check, setCheck] = useState<CvCheckResult | null>(null)
  const [advertCheck, setAdvertCheck] = useState<AdvertCheckResult | null>(null)
  const [prep, setPrep] = useState<InterviewPrep | null>(null)
  const [guide, setGuide] = useState<SalaryGuideResult | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [locked, setLocked] = useState(!proEnabled)
  const [copied, setCopied] = useState<string | null>(null)
  const [trialState, setTrialState] = useState<ProTrialState | undefined>(trial)

  useEffect(() => setTrialState(trial), [trial])

  useEffect(() => {
    setLocked(!proEnabled)
    setPrepared(null)
    setCheck(null)
    setAdvertCheck(null)
    setPrep(null)
    setGuide(null)
    let alive = true
    // Existing packs stay readable after Pro/trial ends.
    void fetchPreparedApplication(job.id)
      .then((body) => alive && setPrepared(body.prepared))
      .catch(() => {})
    if (proEnabled) {
      void fetchApplicationAnswers()
        .then((body) => alive && setAnswers(body.answers))
        .catch((error) => {
          if (alive && error instanceof ApiError && error.status === 403) setLocked(true)
        })
    }
    return () => {
      alive = false
    }
  }, [job.id, proEnabled])

  const refreshInBackground = () => {
    // Trial counters can refresh after the result is already on screen. A
    // slow account read must not leave a finished tool saying it is busy.
    void Promise.resolve(onRefresh?.()).catch(() => undefined)
  }

  const run = async (key: string, work: () => Promise<void>) => {
    setBusy(key)
    setMessage(null)
    try {
      await work()
    } catch (error) {
      const detail = serverMessage(error)
      if (error instanceof ApiError && error.status === 403) {
        setLocked(!prepared)
        setMessage(detail ?? 'This tool is part of Pro. Applying on the employer site stays free.')
      } else {
        setMessage(detail ?? 'We could not finish that. Please try again.')
      }
    } finally {
      setBusy(null)
    }
  }

  const copy = async (label: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(label)
    } catch {
      setMessage('Copy did not work in this browser. Select the text and copy it.')
    }
  }

  const trialPacksLeft = trialState
    ? Math.max(0, trialState.limits.applicationPacks - trialState.applicationPacksUsed)
    : null

  if (locked) {
    return (
      <section className="detail-section pro-tools" aria-label="Pro tools">
        <h2>More help with this application</h2>
        <p>
          Pro can check if this job is open to people in Nigeria. It can compare your CV with the
          job, help you prepare answers, and help you get ready for an interview.
        </p>
        <ul className="plain-list">
          <li>The free trial includes one CV check and help for three jobs.</li>
          <li>We do not ask for card details. The trial ends after 3 days.</li>
          <li>You can always apply free on the company website.</li>
        </ul>
        <p>
          <Lock size={14} /> <a href="/pricing">Start the trial or compare Pro plans</a>
        </p>
        {message ? <p role="status">{message}</p> : null}
        {prepared ? (
          <>
            <h3>Your saved work for this job</h3>
            <p className="field__hint">You can still read, copy and download it.</p>
            <PreparedView prepared={prepared} copied={copied} onCopy={copy} />
          </>
        ) : null}
      </section>
    )
  }

  return (
    <section className="detail-section pro-tools" aria-label="Pro tools">
      <h2>Pro tools for this job</h2>
      {trialState?.status === 'active' ? (
        <p className="trial-inline" role="status">
          Free trial: help for {trialPacksLeft} of {trialState.limits.applicationPacks} jobs is
          left. A new job uses one. The same job does not use another.
        </p>
      ) : null}
      {message ? (
        <p className="banner banner--info" role="status">
          {message}
        </p>
      ) : null}

      <div className="pro-step">
        <h3>
          <ShieldAlert size={17} /> 1. Check this advert before you apply
        </h3>
        <p>
          See what the advert itself says about Nigeria, work permission and time zones, plus any
          visible fee or document warning signs.
        </p>
        <button
          className="btn"
          type="button"
          disabled={busy !== null}
          onClick={() =>
            void run('advert', async () => {
              const result = await runJobAdvertCheck(job.id)
              setAdvertCheck(result.check)
            })
          }
        >
          {busy === 'advert' ? 'Checking...' : 'Check this advert'}
        </button>
        {advertCheck ? <AdvertCheckResultView check={advertCheck} /> : null}
      </div>

      <details className="pro-step">
        <summary>Your saved application answers</summary>
        <p className="field__hint">
          Write your answers once. FJ uses your answers, your profile and your saved CV. FJ will not
          make up work for you.
        </p>
        {ANSWER_FIELDS.map((field) => (
          <div className="field" key={field.key}>
            <label className="field__label" htmlFor={`pro-answer-${field.key}`}>
              {field.label}
            </label>
            {field.textarea ? (
              <textarea
                id={`pro-answer-${field.key}`}
                className="textarea"
                value={answers[field.key]}
                placeholder={field.placeholder}
                onChange={(event) =>
                  setAnswers((current) => ({ ...current, [field.key]: event.target.value }))
                }
              />
            ) : (
              <input
                id={`pro-answer-${field.key}`}
                className="input"
                value={answers[field.key]}
                placeholder={field.placeholder}
                onChange={(event) =>
                  setAnswers((current) => ({ ...current, [field.key]: event.target.value }))
                }
              />
            )}
          </div>
        ))}
        <div className="btnrow">
          <button
            className="btn"
            type="button"
            disabled={busy !== null}
            onClick={() =>
              void run('answers', async () => {
                const saved = await saveApplicationAnswers(answers)
                setAnswers(saved.answers)
                setMessage('Your application answers are saved.')
              })
            }
          >
            {busy === 'answers' ? 'Saving…' : 'Save answers'}
          </button>
        </div>
      </details>

      <div className="pro-step">
        <h3>2. Prepare your application</h3>
        <p>
          FJ will write a cover letter and common answers for this job. If you saved a CV, FJ will
          use it. Read every line. Fill in anything in square brackets before you copy or send it.
        </p>
        <div className="btnrow">
          <button
            className="btn btn--primary"
            type="button"
            disabled={busy !== null}
            onClick={() =>
              void run('prepared', async () => {
                const result = await createPreparedApplication(job.id, answers)
                setPrepared(result.prepared)
                if (result.trial) setTrialState(result.trial)
                setMessage('Your prepared application is ready below.')
                refreshInBackground()
              })
            }
          >
            {busy === 'prepared'
              ? 'Preparing…'
              : prepared
                ? 'Prepare again'
                : 'Prepare application'}
          </button>
        </div>
        {prepared ? <PreparedView prepared={prepared} copied={copied} onCopy={copy} /> : null}
      </div>

      <div className="pro-step">
        <h3>3. Compare your CV with this job</h3>
        <p>
          FJ will use your saved CV. You can paste a different CV here for this one check. We do not
          save pasted text in this tool.
        </p>
        <div className="field">
          <label className="field__label" htmlFor="pro-cv-text">
            Different CV text, optional
          </label>
          <textarea
            id="pro-cv-text"
            className="textarea"
            rows={7}
            value={cvText}
            onChange={(event) => setCvText(event.target.value)}
            placeholder="Leave this empty to use your saved CV or profile."
          />
        </div>
        <button
          className="btn"
          type="button"
          disabled={busy !== null}
          onClick={() =>
            void run('cv', async () => {
              const result = await checkCvForJob(job.id, cvText)
              setCheck(result.check)
              if (result.trial) setTrialState(result.trial)
              refreshInBackground()
            })
          }
        >
          {busy === 'cv' ? 'Checking…' : 'Compare my CV with this job'}
        </button>
        {check ? (
          <div className="stack">
            <p>
              {check.overallPercent === null
                ? 'No percentage is available for this advert.'
                : `Advert wording match: ${check.overallPercent}%.`}{' '}
              {check.message}
            </p>
            {check.requiredMatched.length > 0 ? (
              <p>Required skills found: {check.requiredMatched.join(', ')}.</p>
            ) : null}
            {check.requiredMissing.length > 0 ? (
              <p>Required skills not found: {check.requiredMissing.join(', ')}.</p>
            ) : null}
            {check.evidence?.length ? (
              <>
                <h4>Lines in your CV that support this application</h4>
                <ul className="evidence-list">
                  {check.evidence.map((evidence) => (
                    <li key={`${evidence.skill}-${evidence.line}`}>
                      <strong>{evidence.skill}:</strong> {evidence.line}
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
            {check.tailoredSummary ? (
              <label className="field">
                Summary you can adapt for this job
                <textarea className="textarea" rows={4} readOnly value={check.tailoredSummary} />
                <button
                  className="btn btn--ghost btn--sm"
                  type="button"
                  onClick={() => void copy('summary', check.tailoredSummary ?? '')}
                >
                  {copied === 'summary' ? <Check size={13} /> : <Clipboard size={13} />} Copy
                  summary
                </button>
              </label>
            ) : null}
            <h4>Do these before sending</h4>
            <ul className="plain-list">
              {check.actions.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
            <ul className="plain-list">
              {check.fitNotes.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>

      <div className="pro-step">
        <h3>4. Prepare for the interview</h3>
        <button
          className="btn"
          type="button"
          disabled={busy !== null}
          onClick={() =>
            void run('interview', async () => {
              const result = await fetchInterviewPrep(job.id)
              setPrep(result.prep)
            })
          }
        >
          {busy === 'interview' ? 'Preparing…' : 'Prepare me for interview'}
        </button>
        {prep ? (
          <div>
            <h4>Your 60-second introduction</h4>
            <p>{prep.intro}</p>
            <h4>Questions to practise</h4>
            <ol>
              {prep.questions.map((item) => (
                <li key={item.question}>
                  <strong>{item.question}</strong>
                  <br />
                  {item.prepare}
                </li>
              ))}
            </ol>
            <h4>Examples to prepare</h4>
            <ul>
              {prep.examplesToPrepare.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
            <h4>Questions you can ask</h4>
            <ul>
              {prep.questionsToAsk.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
            <h4>Before the interview</h4>
            <ul>
              {prep.checklist.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>

      <div className="pro-step">
        <h3>5. Check pay evidence</h3>
        <p>Built only from live FJ adverts that stated pay. At least three adverts are needed.</p>
        <button
          className="btn"
          type="button"
          disabled={busy !== null}
          onClick={() =>
            void run('salary', async () => {
              const result = await fetchSalaryGuide({
                role: job.roleFamily !== 'unknown' ? job.roleFamily : undefined,
                country: job.locationCountry || undefined,
                workMode: job.workMode !== 'unknown' ? job.workMode : undefined,
                seniority: job.seniority !== 'unknown' ? job.seniority : undefined,
                currency: job.salaryCurrency || undefined,
                period: job.salaryPeriod !== 'unknown' ? job.salaryPeriod : undefined,
              })
              setGuide(result.guide)
            })
          }
        >
          {busy === 'salary' ? 'Checking…' : 'Show salary guide'}
        </button>
        {guide ? (
          guide.available ? (
            <div>
              <p>
                From {guide.sampleCount} adverts for {guide.scope}: middle pay about{' '}
                {money(guide.medianMidpoint, guide.currency)}
                {guide.period ? ` ${PERIOD_LABELS[guide.period]}` : ''}. The middle half runs from{' '}
                {money(guide.lowerQuartileMidpoint, guide.currency)} to{' '}
                {money(guide.upperQuartileMidpoint, guide.currency)}.
              </p>
              <p>
                Full stated range in those adverts: {money(guide.lowest, guide.currency)} to{' '}
                {money(guide.highest, guide.currency)}.
              </p>
              <p className="field__hint">{guide.message}</p>
            </div>
          ) : (
            <p role="status">{guide.message}</p>
          )
        ) : null}
      </div>
    </section>
  )
}
