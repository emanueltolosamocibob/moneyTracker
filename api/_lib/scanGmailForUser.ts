import { supabaseAdmin } from './supabaseAdmin.js'
import { buildGmailQuery } from './bankSenders.js'
import { refreshAccessToken, listMessageIds, getMessageContent } from './gmail.js'
import { extractAndCategorize, NEW_CATEGORY_CONFIDENCE_THRESHOLD } from './categorize.js'
import { parseStructuredEmail, normalizeMerchantKey } from './parseEmailTemplate.js'

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
  cacheHits: number
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
  let cacheHits = 0

  for (const messageId of batch) {
    const { text, receivedAt } = await getMessageContent(accessToken, messageId)
    if (!text) {
      noText += 1
      continue
    }

    // Los templates de consumo de tarjeta traen Monto/Comercio en una tabla
    // estructurada que se puede leer por regex, sin gastar una llamada a
    // Gemini (ver parseEmailTemplate.ts). Si además el comercio ya tiene una
    // categoría cacheada de una corrida anterior, insertamos directo y nos
    // saltamos el LLM por completo para este mail.
    const parsed = parseStructuredEmail(text)
    if (parsed) {
      const merchantKey = normalizeMerchantKey(parsed.merchant)
      const { data: cached } = await admin
        .from('merchant_categories')
        .select('category_id')
        .eq('user_id', conn.user_id)
        .eq('merchant_key', merchantKey)
        .maybeSingle()

      if (cached) {
        const { error: insertError } = await admin.from('transactions').insert({
          user_id: conn.user_id,
          category_id: cached.category_id,
          amount: parsed.amount,
          currency: 'ARS',
          merchant: parsed.merchant,
          occurred_at: parsed.occurredAt ?? receivedAt,
          type: 'expense',
          source: 'gmail',
          source_email_id: messageId,
          category_confidence: 1,
          needs_review: false,
          payment_method: parsed.paymentMethod,
          card_last4: parsed.cardLast4,
          seen: false,
        })
        if (!insertError) {
          inserted += 1
          cacheHits += 1
        } else if (insertError.code === '23505') {
          conflicts += 1
        } else {
          realErrors += 1
          console.error(`[gmail-scan] insert failed (cache hit) for message=${messageId}:`, insertError)
        }
        continue
      }
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

    // Transferencias entre las propias cuentas del usuario, no un
    // ingreso/gasto real: el patrón observado es un "comercio" que en
    // realidad es un CUIT/CUIL (11 dígitos, sin nombre real detectable),
    // categorizado como Otros, por transferencia, y por un monto grande —
    // se recategoriza a "Interno" para que Transactions.tsx lo excluya de
    // los totales de ingresos/egresos.
    const isElevenDigitMerchant = extracted.merchant ? /^\d{11}$/.test(extracted.merchant.trim()) : false
    const looksInternal =
      categoryId === otrosCategory?.id &&
      extracted.payment_method === 'transfer' &&
      isElevenDigitMerchant &&
      extracted.amount > 400_000
    if (looksInternal) {
      let internalCategory = categories.find((c) => c.name.toLowerCase() === 'interno')
      if (!internalCategory) {
        const { data: created } = await admin
          .from('categories')
          .insert({ user_id: conn.user_id, name: 'Interno', is_default: false })
          .select('id, name')
          .single()
        if (created) {
          categories.push(created)
          internalCategory = created
        }
      }
      if (internalCategory) categoryId = internalCategory.id
    }

    // El mail sí tenía un Comercio parseable por regex pero no estaba en la
    // caché (si hubiera estado, ni habríamos llegado a llamar a Gemini —
    // ver el chequeo de `parsed` más arriba). Ahora que el LLM ya categorizó
    // este comercio, la guardamos para que la próxima vez sea gratis. Solo
    // con confianza razonable, para no cachear una categorización dudosa
    // que después se repetiría sola sin que el LLM la vuelva a revisar.
    if (parsed && categoryId && extracted.confidence >= 0.6) {
      const merchantKey = normalizeMerchantKey(parsed.merchant)
      await admin
        .from('merchant_categories')
        .upsert(
          { user_id: conn.user_id, merchant_key: merchantKey, category_id: categoryId, updated_at: new Date().toISOString() },
          { onConflict: 'user_id,merchant_key' },
        )
    }

    const needsReview = extracted.confidence < 0.6 || !categoryId

    const { error: insertError } = await admin.from('transactions').insert({
      user_id: conn.user_id,
      category_id: categoryId,
      amount: extracted.amount,
      currency: extracted.currency ?? 'ARS',
      merchant: extracted.merchant,
      // Preferimos la fecha que el LLM parseó del cuerpo del mail (más
      // precisa, puede incluir la hora exacta), pero si vino null caemos en
      // la fecha en que Gmail recibió el aviso — no en "ahora". El aviso del
      // banco se manda al instante de la operación, así que es un piso
      // mucho más confiable; con "ahora" una transacción de hace semanas
      // terminaba figurando como la más reciente de la tabla.
      occurred_at: extracted.occurred_at ?? receivedAt,
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
    cacheHits,
  }
  console.log(
    `[gmail-scan] user=${conn.user_id} ok: ${inserted}/${batch.length} nuevas en esta tanda (${pendingIds.length - batch.length} pendientes, sin_texto=${noText} no_es_pago=${notPayment} ya_procesado=${conflicts} error=${realErrors} cache_hits=${cacheHits} hasMore=${hasMore})`,
  )
  return result
}
