/**
 * Email sending for sign-in codes. One interface so the provider can be
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
