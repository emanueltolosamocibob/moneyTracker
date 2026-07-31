// Remitentes conocidos de confirmaciones de pago/transferencia (AR).
// Ajustá esta lista con los bancos/billeteras reales del usuario: cuanto más
// acotada, menos falsos positivos y menos texto le pasamos al LLM.
// Acotado a Santander únicamente por pedido explícito — el resto queda acá
// comentado para reactivar fácil si hace falta agregar otro banco/billetera.
export const BANK_SENDER_DOMAINS = [
  'mensajesyavisos@mails.santander.com.ar',
  // 'notificaciones@mercadopago.com',
  // 'notificaciones@mercadopago.com.ar',
  // 'no-responder@ualá.com.ar',
  // 'notificaciones@bancogalicia.com.ar',
  // 'notificaciones@bbva.com.ar',
  // 'alertas@bancociudad.com.ar',
  // 'notificaciones@brubank.com',
]

// Asuntos reales de confirmación de pago/débito/transferencia de Santander
// (confirmado por el usuario, incluyendo que no hay otros). Filtrar por
// asunto acá, en la búsqueda de Gmail, es lo que de verdad ahorra costo:
// un mail que no matchea ninguno de estos ni se descarga, así que no le
// cuesta ni una llamada a Gemini — a diferencia de dejar que el LLM lo
// descarte después de haberlo leído (el fallback is_payment_confirmation
// en categorize.ts sigue estando ahí como red de seguridad para variantes
// de asunto que no conozcamos, pero la idea es que rara vez tenga que
// actuar). Filtrar solo por remitente no alcanza: promos como "¿Compraste y
// no ahorraste?" o recordatorios como "Tu resumen vence pronto" salen del
// mismo mensajesyavisos@mails.santander.com.ar que los avisos reales.
const TRANSACTION_SUBJECT_TERMS = ['Aviso de débito automático', 'Pagaste', 'Aviso de transferencia']

export function buildGmailQuery(sinceISODate?: string) {
  const fromClause = BANK_SENDER_DOMAINS.map((addr) => `from:${addr}`).join(' OR ')
  const subjectClause = TRANSACTION_SUBJECT_TERMS.map((term) => `subject:"${term}"`).join(' OR ')
  const afterClause = sinceISODate
    ? ` after:${Math.floor(new Date(sinceISODate).getTime() / 1000)}`
    : ''
  return `(${fromClause}) (${subjectClause})${afterClause}`
}
