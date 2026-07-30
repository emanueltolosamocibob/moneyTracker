import { supabaseAdmin } from './supabaseAdmin.js'
import { buildGmailQuery } from './bankSenders.js'
import { refreshAccessToken, listMessageIds, getMessagePlainText } from './gmail.js'
import { extractAndCategorize, NEW_CATEGORY_CONFIDENCE_THRESHOLD } from './categorize.js'

type Admin = ReturnType<typeof supabaseAdmin>
type Connection = { user_id: string; refresh_token: string; last_scanned_at: string | null }

// Compartido entre el cron (recorre todas las conexiones) y el endpoint
// manual /api/gmail/scan (una sola, la del usuario logueado) — ver
// api/cron/scan-gmail.ts y api/gmail/scan.ts.
export async function scanGmailForUser(admin: Admin, conn: Connection): Promise<string> {
  const accessToken = await refreshAccessToken(conn.refresh_token)

  // Nunca busca más atrás que el 1° del mes actual (aunque last_scanned_at
  // sea de un mes anterior, o sea la primera sincronización de la cuenta) —
  // pero dentro del mes sigue siendo incremental para no reprocesar (y
  // volver a gastar LLM en) los mismos mails en cada corrida. Ya no hace
  // falta acotar más que eso: Gemini directo (ver categorize.ts) tiene
  // bastante más margen que el free tier de AI Gateway.
  const startOfMonth = new Date()
  startOfMonth.setDate(1)
  startOfMonth.setHours(0, 0, 0, 0)
  const lastScanned = conn.last_scanned_at ? new Date(conn.last_scanned_at) : null
  const since = lastScanned && lastScanned > startOfMonth ? lastScanned.toISOString() : startOfMonth.toISOString()

  const query = buildGmailQuery(since)
  const messageIds = await listMessageIds(accessToken, query)

  const { data: existingCategories } = await admin
    .from('categories')
    .select('id, name')
    .eq('user_id', conn.user_id)

  // Copia local: si el LLM crea una categoría nueva a mitad del loop, los
  // mails siguientes de esta misma corrida ya la ven (si no, dos comercios
  // nuevos del mismo rubro en la misma corrida terminarían creando dos
  // categorías iguales en vez de reusar la primera).
  const categories = [...(existingCategories ?? [])]
  const otrosCategory = categories.find((c) => c.name.toLowerCase() === 'otros')

  let inserted = 0

  for (const messageId of messageIds) {
    const text = await getMessagePlainText(accessToken, messageId)
    if (!text) continue

    const extracted = await extractAndCategorize(
      text,
      categories.map((c) => c.name),
    )
    if (!extracted.is_payment_confirmation || extracted.amount == null) continue

    let categoryId: string | null = null
    const existingMatch = categories.find((c) => c.name.toLowerCase() === extracted.category.trim().toLowerCase())

    if (existingMatch) {
      categoryId = existingMatch.id
    } else if (
      extracted.is_new_category &&
      extracted.confidence >= NEW_CATEGORY_CONFIDENCE_THRESHOLD &&
      extracted.category.trim().toLowerCase() !== 'otros'
    ) {
      const { data: created } = await admin
        .from('categories')
        .insert({ user_id: conn.user_id, name: extracted.category.trim(), is_default: false })
        .select('id, name')
        .single()
      if (created) {
        categories.push(created)
        categoryId = created.id
      }
    }

    if (!categoryId) {
      categoryId = otrosCategory?.id ?? null
    }

    const needsReview = extracted.confidence < 0.6 || !categoryId

    const { error: insertError } = await admin.from('transactions').insert({
      user_id: conn.user_id,
      category_id: categoryId,
      amount: extracted.amount,
      currency: extracted.currency ?? 'ARS',
      merchant: extracted.merchant,
      occurred_at: extracted.occurred_at ?? new Date().toISOString(),
      type: extracted.type ?? 'expense',
      source: 'gmail',
      source_email_id: messageId,
      category_confidence: extracted.confidence,
      needs_review: needsReview,
      payment_method: extracted.payment_method,
      card_last4: extracted.card_last4,
      seen: false,
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
