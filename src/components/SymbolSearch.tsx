import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabaseClient'

interface SymbolSearchProps {
  value: string
  onChange: (value: string) => void
  // Se dispara solo cuando el símbolo viene de elegir una opción de la
  // lista (click), nunca por tipear — así el form de arriba puede exigir
  // una elección real antes de dejar agregar (ver handleAdd en
  // Investments.tsx).
  onSelect: (value: string) => void
  placeholder?: string
}

// Reemplaza el <input> de texto libre para el símbolo por un buscador real
// contra /api/investments/symbols (ByMA + Twelve Data combinados, sin
// importar la moneda elegida en el toggle) — mismo wrapper .select/.select-panel
// que Select.tsx para que el dropdown se vea igual, pero con un <input> de
// texto en vez de un botón-trigger, porque acá el valor se escribe, no se
// elige de una lista fija.
export default function SymbolSearch({ value, onChange, onSelect, placeholder = 'Símbolo' }: SymbolSearchProps) {
  const [open, setOpen] = useState(false)
  const [options, setOptions] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const requestIdRef = useRef(0)

  useEffect(() => {
    if (!open) return
    function handlePointerDown(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false)
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  useEffect(() => {
    const query = value.trim()
    if (!query) {
      setOptions([])
      setLoading(false)
      return
    }
    const thisRequestId = ++requestIdRef.current
    setLoading(true)
    const timeout = setTimeout(async () => {
      const { data: sessionData } = await supabase.auth.getSession()
      const token = sessionData.session?.access_token
      try {
        const res = await fetch(`/api/investments/symbols?q=${encodeURIComponent(query)}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        })
        const json = await res.json()
        if (thisRequestId !== requestIdRef.current) return
        setOptions(res.ok ? (json.symbols ?? []) : [])
      } catch {
        if (thisRequestId === requestIdRef.current) setOptions([])
      } finally {
        if (thisRequestId === requestIdRef.current) setLoading(false)
      }
    }, 250)
    return () => clearTimeout(timeout)
  }, [value])

  return (
    <div className="select" ref={containerRef}>
      <input
        type="text"
        placeholder={placeholder}
        value={value}
        autoComplete="off"
        onChange={(e) => {
          onChange(e.target.value.toUpperCase())
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
      />
      {open && value.trim() && (
        <ul className="select-panel" role="listbox">
          {loading ? (
            <li className="select-panel-status">Buscando...</li>
          ) : options.length === 0 ? (
            <li className="select-panel-status">Sin resultados</li>
          ) : (
            options.map((sym) => (
              <li
                key={sym}
                role="option"
                aria-selected={sym === value}
                className={sym === value ? 'active' : undefined}
                onClick={() => {
                  onChange(sym)
                  onSelect(sym)
                  setOpen(false)
                }}
              >
                {sym}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  )
}
