// Parser de las alertas de compra/venta del canal de Telegram, sobre los
// mensajes que ya están en `telegram_messages` (ver telegramSync.ts).
//
// El canal usa una plantilla fija y estable — validado a mano sobre el
// histórico completo (84 alertas de compra, ene-ago 2026): el 100% matchea
// este formato. Por eso esto es regex puro y no gasta una llamada al LLM
// (a diferencia de analyze.ts, que sí usa el LLM porque está pensado para un
// grupo genérico sin plantilla fija). Lo que no matchea es comentario de
// mercado y `parseSignal` devuelve null.
//
// Formato real de una alerta de compra:
//   🟢ALERTA DE COMPRA🟢 Nu Holdings Ltd ($NU) ... 🟢Take Profit: 18,54 USD
//   🔴Stop Loss: 16,50 USD 🟢Posible ganancia: 9,76% 🔴Posible perdida: 2,30%
//   ⚠️Riesgo/Beneficio: 4,23 ⏰️Vendemos antes del 25/02 por balances
//
// Y de una de venta:
//   🔴ALERTA DE VENTA🔴 Lockheed Martin ($LMT) ... Nos vamos con una ganancia
//   en dólares de +7,08% ✅ Nos vamos con una ganancia en pesos de +10,40%✅

export interface ParsedSignal {
  kind: 'buy' | 'sell'
  ticker: string | null
  takeProfit: number | null
  stopLoss: number | null
  possibleGainPct: number | null
  possibleLossPct: number | null
  riskBenefit: number | null
  reportedResultPct: number | null
}

// Los números vienen en formato español: punto de miles, coma decimal.
function toNumber(raw: string | undefined): number | null {
  if (!raw) return null
  const n = Number(raw.replace(/\./g, '').replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

function firstMatch(text: string, re: RegExp): string | undefined {
  return re.exec(text)?.[1]
}

export function parseSignal(rawText: string): ParsedSignal | null {
  // El texto llega con saltos de línea y emojis intercalados; normalizar los
  // espacios evita tener que contemplar cada variante de salto en cada regex.
  const text = rawText.replace(/\s+/g, ' ').trim()

  const kind = /ALERTA DE COMPRA/i.test(text) ? 'buy' : /ALERTA DE VENTA/i.test(text) ? 'sell' : null
  if (!kind) return null

  // El ticker siempre viene con $ adelante, entre paréntesis tras el nombre
  // largo de la empresa. Puede faltar (alertas de bonos que solo nombran la
  // especie); en ese caso queda null y no se abre posición.
  const ticker = firstMatch(text, /\$([A-Z]{1,5})\b/) ?? null

  if (kind === 'sell') {
    // Los dos porcentajes de una venta son, en orden, el resultado en dólares
    // y el mismo resultado en pesos (que incluye la variación del dólar y por
    // eso no sirve para medir la operación). Solo guardamos el primero.
    const pct = /([+-])\s*(\d+(?:[.,]\d+)?)\s*%/.exec(text)
    const value = toNumber(pct?.[2])
    return {
      kind,
      ticker,
      takeProfit: null,
      stopLoss: null,
      possibleGainPct: null,
      possibleLossPct: null,
      riskBenefit: null,
      reportedResultPct: value == null ? null : pct?.[1] === '-' ? -value : value,
    }
  }

  // Take Profit a veces trae dos objetivos escalonados ("174,54/183,73 USD").
  // Tomamos el primero: es el que la propia alerta trata como objetivo
  // principal y el que el canal usa para anunciar la venta.
  return {
    kind,
    ticker,
    takeProfit: toNumber(firstMatch(text, /Take Profit:\s*([\d.,]+)/i)),
    stopLoss: toNumber(firstMatch(text, /Stop Loss:\s*([\d.,]+)/i)),
    possibleGainPct: toNumber(firstMatch(text, /ganancia:\s*([\d.,]+)\s*%/i)),
    possibleLossPct: toNumber(firstMatch(text, /p[eé]rdida:\s*([\d.,]+)\s*%/i)),
    riskBenefit: toNumber(firstMatch(text, /Beneficio:\s*([\d.,]+)/i)),
    reportedResultPct: null,
  }
}
