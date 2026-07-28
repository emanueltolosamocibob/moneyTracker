import { useEffect, useRef, useState, type ReactNode } from 'react'
import { IconChevronDown } from './icons'

export interface SelectOption {
  value: string
  label: string
  icon?: ReactNode
}

interface SelectProps {
  value: string
  onChange: (value: string) => void
  options: SelectOption[]
  placeholder: string
}

// Reemplaza al <select> nativo: el popup de un <select> lo dibuja el SO, así
// que no hay forma de estilarlo igual que el resto del formulario (ver
// discusión en el PR). Esto es un botón + una lista propia, con el mismo
// fondo/borde/radius que el resto de los inputs.
export default function Select({ value, onChange, options, placeholder }: SelectProps) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return

    function handlePointerDown(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) {
        setOpen(false)
      }
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

  const selected = options.find((o) => o.value === value)

  return (
    <div className="select" ref={containerRef}>
      <button
        type="button"
        className="select-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="select-trigger-label">
          {selected?.icon}
          {selected?.label ?? placeholder}
        </span>
        <IconChevronDown />
      </button>
      {open && (
        <ul className="select-panel" role="listbox">
          <li
            role="option"
            aria-selected={value === ''}
            className={value === '' ? 'active' : undefined}
            onClick={() => {
              onChange('')
              setOpen(false)
            }}
          >
            {placeholder}
          </li>
          {options.map((opt) => (
            <li
              key={opt.value}
              role="option"
              aria-selected={opt.value === value}
              className={opt.value === value ? 'active' : undefined}
              onClick={() => {
                onChange(opt.value)
                setOpen(false)
              }}
            >
              {opt.icon}
              {opt.label}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
