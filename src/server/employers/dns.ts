/**
 * Domain ownership proofs (Prompt 9) over DNS-over-HTTPS. The organisation's
 * admin publishes a TXT record at _fjverify.<domain>; we read it through a
 * DoH resolver. fetchImpl is injectable so tests never touch real DNS.
 */
export interface DohTxtAnswer {
  name: string
  type: number
  data: string
}

export async function fetchTxtRecords(
  domain: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string[]> {
  const url = `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(`_fjverify.${domain}`)}&type=TXT`
  const response = await fetchImpl(url, {
    headers: { accept: 'application/dns-json' },
  })
  if (!response.ok) throw new Error(`dns_query_failed_${response.status}`)
  const body = (await response.json()) as { Answer?: DohTxtAnswer[] }
  return (body.Answer ?? [])
    .filter((answer) => answer.type === 16)
    .map((answer) => answer.data.replace(/^"|"$/g, ''))
}

/** True when the domain's TXT record carries the exact verification token. */
export async function verifyDomainToken(
  domain: string,
  token: string,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  const records = await fetchTxtRecords(domain, fetchImpl)
  return records.some((record) => record.trim() === `fj-verify=${token}`)
}
