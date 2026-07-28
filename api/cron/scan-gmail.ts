import type { VercelRequest, VercelResponse } from '@vercel/node'
import { supabaseAdmin } from '../_lib/supabaseAdmin'
import { buildGmailQuery } from '../_lib/bankSenders'
import { refreshAccessToken, listMessageIds, getMessagePlainText } from '../_lib/gmail'
import { extractAndCategorize } from '../_lib/categorize'

// Disparado por Vercel Cron (ver vercel.ts). Protegido con CRON_SECRET para
// que no cualquiera pueda pegarle al endpoint y quemar cuota de Gmail/LLM.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  const admin = supabaseAdmin()
  const { data: connections, error } = await admin.from('gmail_connections').select('*')
  if (error) {
    res.status(500).json({ error: error.message })
    return
  }

  const results: Record<string, string> = {}

  for (const conn of connections ?? []) {
    try {
      results[conn.user_id] = await scanConnection(admin, conn)
    } catch (err) {
      results[conn.user_id] = `error: ${(err as Error).message}`
    }
  }

  res.status(200).json({ scanned: connections?.length ?? 0, results })
}

async function scanConnection(
  admin: ReturnType<typeof supabaseAdmin>,
  conn: { user_id: string; refresh_token: string; last_scanned_at: string | null },
) {
  const accessToken = await refreshAccessToken(conn.refresh_token)
  const query = buildGmailQuery(conn.last_scanned_at ?? undefined)
  const messageIds = await listMessageIds(accessToken, query)

  let inserted = 0

  for (const messageId of messageIds) {
    const text = await getMessagePlainText(accessToken, messageId)
    if (!text) continue

    const extracted = await extractAndCategorize(text)
    if (!extracted.is_payment_confirmation || extracted.amount == null) continue

    const { data: category } = await admin
      .from('categories')
      .select('id')
      .eq('user_id', conn.user_id)
      .eq('name', extracted.category)
      .maybeSingle()

    const { error: insertError } = await admin.from('transactions').insert({
      user_id: conn.user_id,
      category_id: category?.id ?? null,
      amount: extracted.amount,
      currency: extracted.currency ?? 'ARS',
      merchant: extracted.merchant,
      occurred_at: extracted.occurred_at ?? new Date().toISOString(),
      type: extracted.type ?? 'expense',
      source: 'gmail',
      source_email_id: messageId,
      category_confidence: extracted.confidence,
      needs_review: extracted.confidence < 0.6,
    })

    // Ignoramos conflictos de unique(user_id, source_email_id): significa
    // que ya habíamos procesado este mail en una corrida anterior.
    if (!insertError) inserted += 1
  }

  await admin
    .from('gmail_connections')
    .update({ last_scanned_at: new Date().toISOString() })
    .eq('user_id', conn.user_id)

  return `ok: ${inserted}/${messageIds.length} nuevas`
}
