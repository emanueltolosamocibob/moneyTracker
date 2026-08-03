import { useEffect, useRef, useState } from 'react'
import { IconChevronDown } from './icons'

interface DateFieldProps {
  value: string // 'YYYY-MM-DD'
  onChange: (value: string) => void
  disabled?: boolean
}

const MOBILE_QUERY = '(max-width: 720px)'
const WEEKDAY_LABELS = ['L', 'M', 'X', 'J', 'V', 'S', 'D']

// Mismo motivo que en Transactions.tsx/Budgets.tsx/Investments.tsx: armar
// la fecha con año/mes/día sueltos usa medianoche local, evitando que el
// día se corra por el desfasaje UTC/Argentina.
function parseDateLocal(dateStr: string) {
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(y, m - 1, d)
}

function formatDateInput(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

// lunes=0 ... domingo=6 (la grilla del calendario arranca en lunes).
function mondayIndex(jsDay: number) {
  return (jsDay + 6) % 7
}

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() => window.matchMedia(MOBILE_QUERY).matches)
  useEffect(() => {
    const mql = window.matchMedia(MOBILE_QUERY)
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches)
    mql.addEventListener('change', handler)
    return () => mql.removeEventListener('change', handler)
  }, [])
  return isMobile
}

// input[type=date] nativo en iOS Safari pinta su contenido interno (los
// segmentos día/mes/año) más ancho que su propia caja en un viewport
// angosto, desbordando el form — un bug de renderizado del control nativo
// que ni font-size ni flex ni overflow:hidden lograron contener de forma
// confiable (varios intentos, ver historial de commits). En vez de seguir
// ajustando a ciegas un control que no se puede inspeccionar en un
// dispositivo real, este componente lo reemplaza por uno propio SOLO en
// mobile — mismo criterio que Select.tsx/Modal.tsx (reemplazar en vez de
// pelear con el elemento nativo cuando no se puede controlar su render).
// En desktop sigue siendo el <input type="date"> de siempre, con su
// calendario nativo del SO.
export default function DateField({ value, onChange, disabled }: DateFieldProps) {
  const isMobile = useIsMobile()

  if (!isMobile) {
    return <input type="date" value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)} />
  }

  return <CustomDatePicker value={value} onChange={onChange} disabled={disabled} />
}

function CustomDatePicker({ value, onChange, disabled }: DateFieldProps) {
  const [open, setOpen] = useState(false)
  const [viewDate, setViewDate] = useState(() => (value ? parseDateLocal(value) : new Date()))
  const containerRef = useRef<HTMLDivElement>(null)

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

  function toggleOpen() {
    if (disabled) return
    setViewDate(value ? parseDateLocal(value) : new Date())
    setOpen((o) => !o)
  }

  const year = viewDate.getFullYear()
  const month = viewDate.getMonth()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const leadingBlanks = mondayIndex(new Date(year, month, 1).getDay())
  const cells: (number | null)[] = [...Array(leadingBlanks).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)]
  const monthLabel = viewDate.toLocaleDateString('es-AR', { month: 'long', year: 'numeric' })

  return (
    <div className="select date-field" ref={containerRef}>
      <button
        type="button"
        className="select-trigger"
        disabled={disabled}
        onClick={toggleOpen}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <span className="select-trigger-label">{value ? parseDateLocal(value).toLocaleDateString('es-AR') : 'dd/mm/aaaa'}</span>
        <IconChevronDown />
      </button>
      {open && (
        <div className="select-panel date-field-panel" role="dialog" aria-label="Elegir fecha">
          <div className="date-field-header">
            <button type="button" aria-label="Mes anterior" onClick={() => setViewDate(new Date(year, month - 1, 1))}>
              ‹
            </button>
            <span>{monthLabel.charAt(0).toUpperCase() + monthLabel.slice(1)}</span>
            <button type="button" aria-label="Mes siguiente" onClick={() => setViewDate(new Date(year, month + 1, 1))}>
              ›
            </button>
          </div>
          <div className="date-field-weekdays">
            {WEEKDAY_LABELS.map((w) => (
              <span key={w}>{w}</span>
            ))}
          </div>
          <div className="date-field-days">
            {cells.map((day, i) => {
              if (day == null) return <span key={`blank-${i}`} />
              const cellStr = formatDateInput(new Date(year, month, day))
              return (
                <button
                  type="button"
                  key={cellStr}
                  className={cellStr === value ? 'active' : undefined}
                  onClick={() => {
                    onChange(cellStr)
                    setOpen(false)
                  }}
                >
                  {day}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
