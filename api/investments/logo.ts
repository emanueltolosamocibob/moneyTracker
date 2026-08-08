import type { VercelRequest, VercelResponse } from '@vercel/node'
import { getUserIdFromRequest } from '../_lib/supabaseAdmin.js'

// Búsqueda de símbolos de TradingView (no documentada — es la misma que usa
// tradingview.com para su propio autocomplete) — cada resultado trae un
// `logoid` a nivel compañía, consistente entre listados del mismo papel en
// distintos exchanges (ej. AAPL en NASDAQ y su CEDEAR en BYMA comparten
// "apple"), así que ni hace falta filtrar por mercado para elegir el logo
// correcto. Requiere Referer/Origin de tradingview.com o devuelve 403 (sin
// CORS tampoco), por eso pasa por acá en vez de pegarle desde el browser.
async function fetchLogoId(query: string): Promise<string | null> {
  const url = `https://symbol-search.tradingview.com/symbol_search/v3/?text=${encodeURIComponent(query)}&hl=1&exchange=&lang=en&search_type=stocks&domain=production`
  const res = await fetch(url, {
    headers: {
      Referer: 'https://www.tradingview.com/',
      Origin: 'https://www.tradingview.com',
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
    },
  })
  if (!res.ok) return null
  const json = await res.json()
  const symbols = (json.symbols ?? []) as Array<{ symbol: string; logoid?: string }>

  // El campo `symbol` viene con <em>...</em> alrededor de lo que matcheó la
  // búsqueda (pensado para resaltar en un autocomplete visual) — hay que
  // sacarlo antes de comparar contra el ticker pedido.
  const target = query.toUpperCase()
  const match = symbols.find((s) => s.symbol.replace(/<\/?em>/g, '').toUpperCase() === target)
  return match?.logoid ?? symbols[0]?.logoid ?? null
}

// Logo del símbolo para las tarjetas de "Cartera actual" en Inversiones.
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

  const symbol = typeof req.query.symbol === 'string' ? req.query.symbol.trim() : ''
  if (!symbol) {
    res.status(200).json({ logoUrl: null })
    return
  }

  // Frágil por diseño (endpoint no oficial de TradingView, puede cambiar o
  // bloquear en cualquier momento) — igual que priceHistory.ts, cualquier
  // falla acá devuelve logoUrl: null en vez de un error, así la tarjeta
  // simplemente no muestra logo en vez de romper Inversiones.
  try {
    const logoid = await fetchLogoId(symbol)
    const logoUrl = logoid ? `https://s3-symbol-logo.tradingview.com/${logoid}--big.svg` : null
    res.status(200).json({ logoUrl })
  } catch {
    res.status(200).json({ logoUrl: null })
  }
}
