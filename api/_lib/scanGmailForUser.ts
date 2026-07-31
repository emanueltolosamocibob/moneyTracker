import { supabaseAdmin } from './supabaseAdmin.js'
import { buildGmailQuery } from './bankSenders.js'
import { refreshAccessToken, listMessageIds, getMessagePlainText } from './gmail.js'
import { extractAndCategorize, NEW_CATEGORY_CONFIDENCE_THRESHOLD } from './categorize.js'

type Admin = ReturnType<typeof supabaseAdmin>
type Connection = { user_id: string; refresh_token: string; last_scanned_at: string | null }

export interface GmailScanResult {
  matched: number
  inserted: number
  noText: number
  notPayment: number
  conflicts: number
  realErrors: number
  hasMore: boolean
}

// Vercel corta la función a los 300s, y un mail ambiguo puede disparar
// ráfagas de varias llamadas a Gemini casi juntas (ver researchMerchant en
// categorize.ts) que se comen la cuota de golpe aunque estén espaciadas
// entre mails. Procesar de a poco por invocación — y que el llamador
// (api/gmail/scan.ts) repita mientras haya `hasMore` — mantiene cada
// request corta y acota el daño de una falla de cuota a un puñado de mails
// en vez de perder el progreso de todo un mes.
const BATCH_SIZE = 5

// Compartido entre el cron (recorre todas las conexiones) y el endpoint
// manual /api/gmail/scan (una sola, la del usuario logueado) — ver
// api/cron/scan-gmail.ts y api/gmail/scan.ts.
export async function scanGmailForUser(admin: Admin, conn: Connection): Promise<GmailScanResult> {
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
  console.log(`[gmail-scan] user=${conn.user_id} since=${since} query="${query}" matched=${messageIds.length}`)

  // last_scanned_at recién avanza si el loop de abajo termina entero sin
  // tirar — un timeout, un error no atrapado, o quedarse sin cuota de
  // Gemini a mitad de camino lo deja intacto. Sin este chequeo previo, un
  // reintento después de una corrida cortada vuelve a gastar 1-3 llamadas a
  // Gemini por cada mail que ya se había insertado bien, solo para
  // descubrir recién en el insert que era un conflicto de
  // unique(user_id, source_email_id) — plata de cuota tirada en mails que
  // no necesitaban ni un LLM call.
  let alreadyProcessedIds = new Set<string | null>()
  if (messageIds.length > 0) {
    const { data: alreadyProcessed } = await admin
      .from('transactions')
      .select('source_email_id')
      .eq('user_id', conn.user_id)
      .in('source_email_id', messageIds)
    alreadyProcessedIds = new Set((alreadyProcessed ?? []).map((t) => t.source_email_id))
  }

  const pendingIds = messageIds.filter((id) => !alreadyProcessedIds.has(id))
  const batch = pendingIds.slice(0, BATCH_SIZE)
  const hasMore = pendingIds.length > batch.length
  const conflictsFromDedup = messageIds.length - pendingIds.length

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
  let noText = 0
  let notPayment = 0
  let conflicts = conflictsFromDedup
  let realErrors = 0

  for (const messageId of batch) {
    const text = await getMessagePlainText(accessToken, messageId)
    if (!text) {
      noText += 1
      continue
    }

    const extracted = await extractAndCategorize(
      text,
      categories.map((c) => c.name),
    )
    if (!extracted.is_payment_confirmation || extracted.amount == null) {
      notPayment += 1
      continue
    }

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

    if (!insertError) {
      inserted += 1
    } else if (insertError.code === '23505') {
      // unique(user_id, source_email_id): ya habíamos procesado este mail
      // en una corrida anterior — esperado, no es un error real.
      conflicts += 1
    } else {
      // Antes esto se descartaba en silencio junto con los conflictos
      // esperados, así que un error real acá (constraint distinta, columna
      // NOT NULL, etc.) no dejaba rastro — se veía como "no trajo nada
      // nuevo" sin ninguna pista de por qué.
      realErrors += 1
      console.error(`[gmail-scan] insert failed for message=${messageId}:`, insertError)
    }
  }

  // Solo avanza el checkpoint cuando esta tanda cubrió todo lo pendiente de
  // la ventana — si hasMore, la próxima invocación tiene que volver a mirar
  // el mismo `since` (los ya procesados se saltan por el chequeo de arriba,
  // sin gastar LLM en ellos de nuevo).
  if (!hasMore) {
    await admin
      .from('gmail_connections')
      .update({ last_scanned_at: new Date().toISOString() })
      .eq('user_id', conn.user_id)
  }

  const result: GmailScanResult = {
    matched: messageIds.length,
    inserted,
    noText,
    notPayment,
    conflicts,
    realErrors,
    hasMore,
  }
  console.log(
    `[gmail-scan] user=${conn.user_id} ok: ${inserted}/${batch.length} nuevas en esta tanda (${pendingIds.length - batch.length} pendientes, sin_texto=${noText} no_es_pago=${notPayment} ya_procesado=${conflicts} error=${realErrors} hasMore=${hasMore})`,
  )
  return result
}
