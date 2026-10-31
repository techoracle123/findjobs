import { useEffect, useState } from 'react'
import { Check, Clipboard, Lock } from 'lucide-react'
import type {
  ApplicationAnswers,
  CvCheckResult,
  InterviewPrep,
  Job,
  PreparedApplication,
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
  saveApplicationAnswers,
} from '../lib/api'
import { formatRange, PERIOD_LABELS } from '../shared/format'

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

export function ProTools({ job, proEnabled }: { job: Job; proEnabled: boolean }) {
  const [answers, setAnswers] = useState<ApplicationAnswers>(EMPTY_ANSWERS)
  const [prepared, setPrepared] = useState<PreparedApplication | null>(null)
  const [cvText, setCvText] = useState('')
  const [check, setCheck] = useState<CvCheckResult | null>(null)
  const [prep, setPrep] = useState<InterviewPrep | null>(null)
  const [guide, setGuide] = useState<SalaryGuideResult | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [locked, setLocked] = useState(!proEnabled)
  const [copied, setCopied] = useState<string | null>(null)

  useEffect(() => {
    setLocked(!proEnabled)
    if (!proEnabled) return
    let alive = true
    void Promise.allSettled([fetchApplicationAnswers(), fetchPreparedApplication(job.id)]).then(
      ([answerResult, preparedResult]) => {
        if (!alive) return
        if (answerResult.status === 'fulfilled') setAnswers(answerResult.value.answers)
        if (preparedResult.status === 'fulfilled') setPrepared(preparedResult.value.prepared)
        const denied = [answerResult, preparedResult].some(
          (result) =>
            result.status === 'rejected' &&
            result.reason instanceof ApiError &&
            result.reason.status === 403,
        )
        if (denied) setLocked(true)
      },
    )
    return () => {
      alive = false
    }
  }, [job.id, proEnabled])

  const run = async (key: string, work: () => Promise<void>) => {
    setBusy(key)
    setMessage(null)
    try {
      await work()
    } catch (error) {
      if (error instanceof ApiError && error.status === 403) {
        setLocked(true)
        setMessage('This tool is part of Pro. Applying on the employer site stays free.')
      } else {
        setMessage('That could not be finished just now. Please try again.')
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

  if (locked) {
    return (
      <section className="detail-section" aria-label="Pro tools">
        <h2>More help with this application</h2>
        <p>
          Pro prepares copy-ready application answers, checks your CV against this advert, prepares
          you for interview questions, and shows a salary guide from real adverts with pay stated.
        </p>
        <p>
          <Lock size={14} /> <a href="/pricing">See Pro plans</a>. Applying on the employer&apos;s
          site stays free.
        </p>
        {message && <p role="status">{message}</p>}
      </section>
    )
  }

  return (
    <section className="detail-section" aria-label="Pro tools">
      <h2>Pro tools for this job</h2>
      {message && (
        <p className="banner banner--info" role="status">
          {message}
        </p>
      )}

      <details>
        <summary>Your saved application answers</summary>
        <p className="field__hint">
          Save these once. FJ uses only what you write here and the skills in your profile. It does
          not invent experience for you.
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

      <h3>Prepared application</h3>
      <p>
        Create a cover letter and common answers for this job. Check every line, replace anything in
        square brackets, then copy or send it yourself.
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
              setMessage('Your prepared application is ready below.')
            })
          }
        >
          {busy === 'prepared' ? 'Preparing…' : prepared ? 'Prepare again' : 'Prepare application'}
        </button>
        {prepared?.mailtoUrl && (
          <a className="btn" href={prepared.mailtoUrl}>
            Open ready-to-send email
          </a>
        )}
      </div>
      {prepared && (
        <div>
          {prepared.missingInfo.length > 0 && (
            <p className="banner banner--demo" role="status">
              Before sending, add: {prepared.missingInfo.join(', ')}.
            </p>
          )}
          <div className="field">
            <span className="field__label">Subject</span>
            <input className="input" readOnly value={prepared.subject} />
          </div>
          <div className="field">
            <span className="field__label">Cover letter</span>
            <textarea className="textarea" readOnly rows={14} value={prepared.coverLetter} />
          </div>
          <button
            className="btn"
            type="button"
            onClick={() => void copy('cover', prepared.coverLetter)}
          >
            {copied === 'cover' ? <Check size={14} /> : <Clipboard size={14} />} Copy cover letter
          </button>
          {prepared.answers.map((item) => (
            <div className="field" key={item.question}>
              <span className="field__label">{item.question}</span>
              <textarea className="textarea" readOnly rows={4} value={item.answer} />
              <button
                className="btn btn--ghost btn--sm"
                type="button"
                onClick={() => void copy(item.question, item.answer)}
              >
                {copied === item.question ? <Check size={13} /> : <Clipboard size={13} />} Copy
                answer
              </button>
            </div>
          ))}
          <ul>
            {prepared.checklist.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      )}

      <h3>CV check for this job</h3>
      <p>
        Paste your CV text for a closer check, or leave it empty to check the skills saved in your
        profile. The pasted text is used for this check and is not saved here.
      </p>
      <div className="field">
        <label className="field__label" htmlFor="pro-cv-text">
          CV text, optional
        </label>
        <textarea
          id="pro-cv-text"
          className="textarea"
          rows={7}
          value={cvText}
          onChange={(event) => setCvText(event.target.value)}
          placeholder="Paste the text from your CV here."
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
          })
        }
      >
        {busy === 'cv' ? 'Checking…' : 'Check my CV'}
      </button>
      {check && (
        <div>
          <p>
            {check.overallPercent === null
              ? 'No percentage is available for this advert.'
              : `Advert wording match: ${check.overallPercent}%.`}{' '}
            {check.message}
          </p>
          {check.requiredMatched.length > 0 && (
            <p>Required skills found: {check.requiredMatched.join(', ')}.</p>
          )}
          {check.requiredMissing.length > 0 && (
            <p>Required skills not found: {check.requiredMissing.join(', ')}.</p>
          )}
          <ul>
            {check.actions.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <ul>
            {check.fitNotes.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      )}

      <h3>Interview preparation</h3>
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
      {prep && (
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
      )}

      <h3>Salary guide for similar roles</h3>
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
      {guide &&
        (guide.available ? (
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
        ))}
    </section>
  )
}
