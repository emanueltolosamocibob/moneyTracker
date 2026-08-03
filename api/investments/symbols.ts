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
// ARS sale de ByMA (data912, sin key); USD sale de Twelve Data (con key,
// por eso pasa por acá y no directo desde el cliente).
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

  const market = req.query.market === 'world' ? 'world' : 'ar'
  const query = typeof req.query.q === 'string' ? req.query.q.trim() : ''
  if (!query) {
    res.status(200).json({ symbols: [] })
    return
  }

  try {
    const symbols = market === 'world' ? await searchWorldSymbols(query) : await searchArSymbols(query)
    res.status(200).json({ symbols })
  } catch (err) {
    res.status(502).json({ error: (err as Error).message })
  }
}
