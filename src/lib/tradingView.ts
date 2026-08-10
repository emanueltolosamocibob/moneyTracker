import type { MouseEvent } from 'react'

// Links a TradingView, compartidos entre la tabla de alertas de Telegram y el
// modal de análisis de un símbolo — el mismo gesto (click en el ticker) tiene
// que hacer lo mismo en los dos lados.

export function tradingViewUrl(ticker: string) {
  return `https://www.tradingview.com/symbols/${encodeURIComponent(ticker)}/`
}

export function tradingViewCedearUrl(ticker: string) {
  return `https://www.tradingview.com/symbols/BCBA-${encodeURIComponent(ticker)}/`
}

// Un click abre las dos pestañas: el papel original y su CEDEAR en BCBA (el
// mismo ticker suele cotizar en las dos plazas, ver CLAUDE.md sobre GGAL/
// YPF/PAM). El href sigue apuntando al papel original — así clicks que no
// disparan onClick (ctrl/cmd+click, click del medio, "abrir en pestaña
// nueva" del menú contextual) siguen abriendo esa sola pestaña en vez de
// quedar rotos.
export function openTickerTabs(e: MouseEvent<HTMLAnchorElement>, ticker: string) {
  if (e.button === 1 || e.metaKey || e.ctrlKey || e.shiftKey) return
  e.preventDefault()
  e.stopPropagation()
  // El segundo click de un doble click no vuelve a abrir las pestañas: en la
  // tabla de alertas el doble click abre el análisis, y sin esto un usuario
  // que hace doble click sobre el ticker se come cuatro pestañas antes de ver
  // el modal.
  if (e.detail > 1) return
  window.open(tradingViewUrl(ticker), '_blank', 'noopener,noreferrer')
  window.open(tradingViewCedearUrl(ticker), '_blank', 'noopener,noreferrer')
}
