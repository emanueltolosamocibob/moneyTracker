const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'
const GMAIL_API_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me'

export async function refreshAccessToken(refreshToken: string): Promise<string> {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  })
  if (!res.ok) {
    throw new Error(`No se pudo refrescar el access token de Gmail: ${res.status} ${await res.text()}`)
  }
  const data = (await res.json()) as { access_token: string }
  return data.access_token
}

// Gmail devuelve los mensajes más recientes primero y nunca más de
// maxResults por página — sin paginar acá, una cuenta con más de un puñado
// de mails matcheados en la ventana del scan pierde silenciosamente todo lo
// que quede más atrás que la primera página (efecto indistinguible de una
// ventana de fechas más corta, aunque `since` esté bien calculado).
export async function listMessageIds(accessToken: string, query: string): Promise<string[]> {
  const ids: string[] = []
  let pageToken: string | undefined

  do {
    const params: Record<string, string> = { q: query, maxResults: '500' }
    if (pageToken) params.pageToken = pageToken

    const url = `${GMAIL_API_BASE}/messages?${new URLSearchParams(params)}`
    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } })
    if (!res.ok) throw new Error(`Gmail list failed: ${res.status} ${await res.text()}`)
    const data = (await res.json()) as { messages?: { id: string }[]; nextPageToken?: string }

    ids.push(...(data.messages ?? []).map((m) => m.id))
    pageToken = data.nextPageToken
  } while (pageToken)

  return ids
}

export interface GmailMessageContent {
  text: string
  // Cuándo Gmail recibió el mail (epoch ms como string, el campo
  // `internalDate` de la API) convertido a ISO — el aviso del banco se manda
  // prácticamente al instante de la operación, así que esto es un piso
  // confiable para occurred_at cuando el LLM no logra parsear una fecha del
  // cuerpo del mail. Mucho mejor que caer en "ahora": eso hacía que
  // transacciones de hace semanas aparecieran arriba de todo, ordenadas como
  // si fueran de hoy.
  receivedAt: string
}

export async function getMessageContent(accessToken: string, messageId: string): Promise<GmailMessageContent> {
  const url = `${GMAIL_API_BASE}/messages/${messageId}?format=full`
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } })
  if (!res.ok) throw new Error(`Gmail get failed: ${res.status} ${await res.text()}`)
  const data = await res.json()
  const text = extractPlainText(data.payload) || data.snippet || ''
  const receivedAt = data.internalDate ? new Date(Number(data.internalDate)).toISOString() : new Date().toISOString()
  return { text, receivedAt }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractPlainText(payload: any): string {
  if (!payload) return ''
  if (payload.mimeType === 'text/plain' && payload.body?.data) {
    return decodeBase64Url(payload.body.data)
  }
  if (payload.mimeType === 'text/html' && payload.body?.data && !payload.parts) {
    return stripHtml(decodeBase64Url(payload.body.data))
  }
  for (const part of payload.parts ?? []) {
    const text = extractPlainText(part)
    if (text) return text
  }
  return ''
}

function decodeBase64Url(data: string): string {
  return Buffer.from(data, 'base64url').toString('utf-8')
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}
