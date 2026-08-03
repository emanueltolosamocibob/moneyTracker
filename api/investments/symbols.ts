import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getUserIdFromRequest } from '../_lib/supabaseAdmin.js'

const MAX_RESULTS = 20

interface Data912Row {
  symbol: string
}

// Endpoint público sin auth de ByMA (sin key, pero tampoco manda CORS —
// por eso pasa por acá en vez de pegarle directo desde el browser). Solo
// nos interesa el campo `symbol`, todo lo demás (precios, volumen) se
// descarta.
async function searchArSymbols(query: string): Promise<string[]> {
  const res = await fetch('https://data912.com/live/arg_stocks')
  if (!res.ok) throw new Error('No se pudo obtener el listado de símbolos de ByMA.')
  const rows = (await res.json()) as Data912Row[]
  const q = query.toUpperCase()
  return Array.from(new Set(rows.map((r) => r.symbol).filter((s) => s?.toUpperCase().startsWith(q))))
    .sort()
    .slice(0, MAX_RESULTS)
}

interface TwelveDataMatch {
  symbol: string
}

async function searchWorldSymbols(query: string): Promise<string[]> {
  const apiKey = process.env.TWELVE_DATA_API_KEY
  if (!apiKey) throw new Error('Falta configurar TWELVE_DATA_API_KEY.')
  const url = `https://api.twelvedata.com/symbol_search?symbol=${encodeURIComponent(query)}&outputsize=${MAX_RESULTS}&apikey=${apiKey}`
  const res = await fetch(url)
  const json = await res.json()
  if (!res.ok || json.status === 'error') {
    throw new Error(json.message ?? 'No se pudo buscar símbolos.')
  }
  const matches = (json.data ?? []) as TwelveDataMatch[]
  return Array.from(new Set(matches.map((m) => m.symbol).filter(Boolean))).slice(0, MAX_RESULTS)
}

// Búsqueda de símbolos para el campo "Símbolo" en Inversiones — solo
// devuelve tickers, nunca precio (eso lo sigue cargando el usuario a mano).
// Busca en las dos fuentes siempre, sin importar qué moneda (ARS/USD) esté
// elegida en el form — esa elección es solo cómo se va a valuar la
// posición, no una restricción real de qué símbolos existen, así que
// filtrar la búsqueda por ahí solo escondía resultados válidos.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const userId = await getUserIdFromRequest(req.headers.authorization)
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized' })
    return
  }

  const query = typeof req.query.q === 'string' ? req.query.q.trim() : ''
  if (!query) {
    res.status(200).json({ symbols: [] })
    return
  }

  const [arResult, worldResult] = await Promise.allSettled([searchArSymbols(query), searchWorldSymbols(query)])
  const symbols = new Set<string>()
  if (arResult.status === 'fulfilled') arResult.value.forEach((s) => symbols.add(s))
  if (worldResult.status === 'fulfilled') worldResult.value.forEach((s) => symbols.add(s))

  // Si las dos fuentes fallaron (ej. Twelve Data caído y ByMA también),
  // ahí sí es un error real y no una lista vacía silenciosa.
  if (arResult.status === 'rejected' && worldResult.status === 'rejected') {
    res.status(502).json({ error: (arResult.reason as Error).message })
    return
  }

  res.status(200).json({ symbols: Array.from(symbols).sort().slice(0, MAX_RESULTS) })
}
