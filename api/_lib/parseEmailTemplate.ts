// Los templates de Santander de consumo de tarjeta ("Aviso de débito
// automático", "Pagaste $X") traen los datos en una tabla HTML bien
// estructurada — Monto/Comercio/Fecha/Hora como pares label-valor. Una vez
// que gmail.ts les saca el HTML a los tags, quedan como texto plano
// separado por espacios en el mismo orden. Parsearlos por regex evita
// gastar una llamada a Gemini en mails de comercios ya conocidos (ver
// scanGmailForUser.ts). Los avisos de transferencia no tienen un campo
// "Comercio" tan claro (tienen Destinatario/CBU en su lugar), así que para
// esos esta función devuelve null y el mail sigue el pipeline de Gemini de
// siempre — no hace falta detectar el template de antemano, alcanza con
// chequear si el parseo encontró lo esencial (monto + comercio).
export interface ParsedEmailTransaction {
  amount: number
  merchant: string
  // null si no se pudo leer Fecha/Hora del mail — el llamador cae al mismo
  // fallback que ya usa con el resultado del LLM (fecha en que Gmail recibió
  // el aviso, no "ahora").
  occurredAt: string | null
  paymentMethod: 'credit_card' | 'debit_card' | null
  cardLast4: string | null
}

function parseArgentineAmount(raw: string): number {
  // "76.024,09" -> "76024.09" (separador de miles ".", decimal ",").
  return Number(raw.replace(/\./g, '').replace(',', '.'))
}

function buildOccurredAtISO(dateStr: string, timeStr: string | null): string | null {
  const dateMatch = dateStr.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (!dateMatch) return null
  const [, d, m, y] = dateMatch.map(Number)
  const [hh, mm] = timeStr ? timeStr.split(':').map(Number) : [0, 0]
  // ART es UTC-3 todo el año (sin horario de verano) — 06:01 hora local es
  // 09:01 UTC.
  return new Date(Date.UTC(y, m - 1, d, hh + 3, mm)).toISOString()
}

export function parseStructuredEmail(text: string): ParsedEmailTransaction | null {
  const amountMatch = text.match(/Monto\s*\$?\s*([\d.,]+)/i)
  const merchantMatch = text.match(/Comercio\s+(.+?)\s*(?=(?:Fecha\s|Hora\s|Cuotas\s|Monto\s|$))/i)
  if (!amountMatch || !merchantMatch) return null

  const amount = parseArgentineAmount(amountMatch[1])
  const merchant = merchantMatch[1].trim()
  if (!amount || !merchant) return null

  const dateMatch = text.match(/Fecha\s+(\d{1,2}\/\d{1,2}\/\d{4})/i)
  const timeMatch = text.match(/Hora\s+(\d{1,2}:\d{2})/i)
  const occurredAt = dateMatch ? buildOccurredAtISO(dateMatch[1], timeMatch?.[1] ?? null) : null

  const cardLast4Match = text.match(/terminada en (\d{4})/i)
  let paymentMethod: 'credit_card' | 'debit_card' | null = null
  if (/cr[eé]dito/i.test(text)) paymentMethod = 'credit_card'
  else if (/d[eé]bito/i.test(text)) paymentMethod = 'debit_card'

  return {
    amount,
    merchant,
    occurredAt,
    paymentMethod,
    cardLast4: cardLast4Match ? cardLast4Match[1] : null,
  }
}

// Mismo criterio de normalización en los dos sentidos (guardar y buscar en
// la caché): trim + mayúsculas + espacios colapsados, para que variaciones
// triviales de formato no rompan el match.
export function normalizeMerchantKey(merchant: string): string {
  return merchant.trim().toUpperCase().replace(/\s+/g, ' ')
}
