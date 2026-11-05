/**
 * Email sending for account messages (password reset links, sign-in codes).
 * One interface so the provider can be swapped in one file. Providers are
 * called through plain REST, with no vendor SDK in the bundle. When no key is
 * configured the console provider logs the message, which is what local
 * development and tests use.
 */
export interface EmailMessage {
  to: string
  subject: string
  text: string
  html?: string
}

export interface EmailProvider {
  readonly name: string
  send(message: EmailMessage): Promise<{ id: string }>
}

export class ConsoleEmailProvider implements EmailProvider {
  readonly name = 'console'
  async send(message: EmailMessage): Promise<{ id: string }> {
    console.info(`[email:console] to=${message.to} subject=${message.subject} text=${message.text}`)
    return { id: 'console' }
  }
}

export class ResendProvider implements EmailProvider {
  readonly name = 'resend'
  constructor(
    private readonly apiKey: string,
    private readonly from: string,
  ) {}
  async send(message: EmailMessage): Promise<{ id: string }> {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: this.from,
        to: [message.to],
        subject: message.subject,
        text: message.text,
        ...(message.html ? { html: message.html } : {}),
      }),
    })
    if (!response.ok) throw new Error(`email_send_failed_${response.status}`)
    const body = (await response.json()) as { id?: string }
    return { id: body.id ?? 'sent' }
  }
}

export interface SenderAddress {
  name: string
  email: string
}

const EMAIL_PATTERN = /^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/

/**
 * Reads either a plain address (`fj@example.com`) or the display form
 * (`FJ - Find Jobs <fj@example.com>`). The no-domain Brevo setup stores the
 * verified Gmail address on its own, so both forms must work.
 */
export function parseSenderAddress(
  value: string | undefined,
  fallbackName = 'FJ - Find Jobs',
): SenderAddress | null {
  const raw = value?.trim()
  if (!raw) return null
  const bracketed = raw.match(/<([^<>]+)>/)
  const email = (bracketed?.[1] ?? raw).trim().toLowerCase()
  if (!EMAIL_PATTERN.test(email)) return null
  const name = bracketed
    ? raw.slice(0, bracketed.index).trim().replace(/^"|"$/g, '').replace(/[<>]/g, '').slice(0, 80)
    : ''
  return { name: name || fallbackName, email }
}

export interface EmailEnv {
  BREVO_API_KEY?: string
  BREVO_SENDER_EMAIL?: string
  RESEND_API_KEY?: string
  EMAIL_FROM?: string
  OTP_FROM?: string
}

function senderFromEnv(env: EmailEnv): SenderAddress | null {
  return (
    parseSenderAddress(env.EMAIL_FROM) ??
    parseSenderAddress(env.BREVO_SENDER_EMAIL) ??
    parseSenderAddress(env.OTP_FROM)
  )
}

/** Brevo sends over HTTPS from one verified sender address; no DNS is needed. */
export class BrevoProvider implements EmailProvider {
  readonly name = 'brevo'
  private readonly fetchFn: typeof fetch

  constructor(
    private readonly apiKey: string,
    private readonly sender: SenderAddress,
    fetchFn: typeof fetch = fetch,
  ) {
    // The platform's native fetch must be called as a plain function, not as
    // `this.fetchFn(...)`: in the hosted runtime that method-style call is
    // rejected with "Illegal invocation" before any request is made. Wrap it
    // once here so the provider can never call it with the wrong receiver.
    this.fetchFn = ((input, init) => fetchFn(input, init)) as typeof fetch
  }

  private safeErrorDetail(value: unknown, message: EmailMessage): string {
    return String(value ?? '')
      .replaceAll(this.apiKey, '[redacted]')
      .replaceAll(message.to, '[redacted]')
      .replaceAll(this.sender.email, '[redacted]')
      .replace(/[\r\n]+/g, ' ')
      .trim()
      .slice(0, 180)
  }

  async send(message: EmailMessage): Promise<{ id: string }> {
    const response = await this.fetchFn('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'api-key': this.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        sender: this.sender,
        to: [{ email: message.to }],
        subject: message.subject,
        textContent: message.text,
        ...(message.html ? { htmlContent: message.html } : {}),
      }),
    })
    if (!response.ok) {
      const errorBody = (await response.json().catch(() => ({}))) as {
        code?: unknown
        message?: unknown
      }
      const code = this.safeErrorDetail(errorBody.code, message)
      const detail = this.safeErrorDetail(errorBody.message, message)
      const suffix = [code, detail].filter(Boolean).join(':')
      throw new Error(`email_send_failed_${response.status}${suffix ? `:${suffix}` : ''}`)
    }
    const body = (await response.json().catch(() => ({}))) as { messageId?: string }
    return { id: body.messageId ?? 'sent' }
  }
}

export function hasConfiguredEmailProvider(env: EmailEnv): boolean {
  return Boolean((env.BREVO_API_KEY && senderFromEnv(env)) || env.RESEND_API_KEY)
}

/**
 * Picks the provider from the environment; console when nothing is set.
 * Brevo wins when its key and verified sender are both present because that
 * is the no-domain setup. Removing the Brevo key falls back to Resend.
 */
export function emailProviderFromEnv(env: EmailEnv): EmailProvider {
  const sender = senderFromEnv(env)
  if (env.BREVO_API_KEY && sender) return new BrevoProvider(env.BREVO_API_KEY, sender)
  if (env.RESEND_API_KEY) {
    return new ResendProvider(
      env.RESEND_API_KEY,
      env.EMAIL_FROM ?? env.OTP_FROM ?? 'FJ - Find Jobs <onboarding@resend.dev>',
    )
  }
  return new ConsoleEmailProvider()
}

/** The branded sign-in code email. Plain, short, no vendor names. */
export function otpEmail(code: string): { subject: string; text: string; html: string } {
  return {
    subject: `${code} is your FJ sign-in code`,
    text: `Your FJ sign-in code is ${code}. It works once and expires in 10 minutes. FJ will never ask you for this code. If you did not ask for this, ignore this email.`,
    html: `<div style="font-family:ui-sans-serif,system-ui,sans-serif;max-width:480px;margin:0 auto;padding:32px">
  <h1 style="font-size:20px;margin:0 0 8px">Your sign-in code</h1>
  <p style="color:#6b7160;margin:0 0 24px">Enter this code to continue. It expires in 10 minutes.</p>
  <div style="font-size:34px;letter-spacing:8px;font-weight:600;font-family:ui-monospace,monospace;padding:20px;background:#f4f5ef;border-radius:10px;text-align:center">${code}</div>
  <p style="color:#6b7160;font-size:13px;margin:24px 0 0">FJ will never ask you for this code. If you did not request it, ignore this email.</p>
</div>`,
  }
}

/** The password reset email. The link carries a one-hour, one-use token. */
export function passwordResetEmail(link: string): { subject: string; text: string; html: string } {
  return {
    subject: 'Reset your FJ password',
    text: `Open this link within one hour to choose a new password for your FJ account: ${link}\n\nIf you did not ask for this, ignore this email. Your password stays the same. FJ will never ask you for your password.`,
    html: `<div style="font-family:ui-sans-serif,system-ui,sans-serif;max-width:480px;margin:0 auto;padding:32px">
  <h1 style="font-size:20px;margin:0 0 8px">Reset your password</h1>
  <p style="color:#6b7160;margin:0 0 24px">Tap the button within one hour to choose a new password for your FJ account.</p>
  <p style="text-align:center;margin:0 0 24px"><a href="${link}" style="display:inline-block;padding:14px 22px;background:#5b744d;color:#ffffff;border-radius:10px;text-decoration:none;font-weight:600">Choose a new password</a></p>
  <p style="color:#6b7160;font-size:13px;margin:0">If the button does not work, open this link: ${link}</p>
  <p style="color:#6b7160;font-size:13px;margin:16px 0 0">If you did not ask for this, ignore this email. Your password stays the same.</p>
</div>`,
  }
}
