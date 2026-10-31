/**
 * Email sending for account messages (password reset links, sign-in codes).
 * One interface so the provider can be
 * swapped in one file. Resend is used via plain REST — no vendor SDK in the
 * bundle. When no key is configured the console provider logs the code,
 * which is what local development and tests use.
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

/** Picks the provider from the environment; console when nothing is set. */
export function emailProviderFromEnv(env: {
  RESEND_API_KEY?: string
  EMAIL_FROM?: string
  OTP_FROM?: string
}): EmailProvider {
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
