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
}): EmailProvider {
  if (env.RESEND_API_KEY) {
    return new ResendProvider(
      env.RESEND_API_KEY,
      env.EMAIL_FROM ?? 'FJ <no-reply@fj-find-jobs.pages.dev>',
    )
  }
  return new ConsoleEmailProvider()
}
