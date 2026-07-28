// Remitentes conocidos de confirmaciones de pago/transferencia (AR).
// Ajustá esta lista con los bancos/billeteras reales del usuario: cuanto más
// acotada, menos falsos positivos y menos texto le pasamos al LLM.
export const BANK_SENDER_DOMAINS = [
  'notificaciones@mercadopago.com',
  'notificaciones@mercadopago.com.ar',
  'no-responder@ualá.com.ar',
  'notificaciones@bancogalicia.com.ar',
  'notificaciones@santanderrio.com.ar',
  'notificaciones@bbva.com.ar',
  'alertas@bancociudad.com.ar',
  'notificaciones@brubank.com',
]

export function buildGmailQuery(sinceISODate?: string) {
  const fromClause = BANK_SENDER_DOMAINS.map((addr) => `from:${addr}`).join(' OR ')
  const afterClause = sinceISODate
    ? ` after:${Math.floor(new Date(sinceISODate).getTime() / 1000)}`
    : ''
  return `(${fromClause})${afterClause}`
}
