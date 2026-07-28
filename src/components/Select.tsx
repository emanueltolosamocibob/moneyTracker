import { useEffect, useRef, useState, type ReactNode } from 'react'
import { IconChevronDown, IconPlus, IconX } from './icons'

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
  /** Si se pasa, agrega una fila "+ agregar" al final con un mini-form de un solo campo (nombre). */
  onCreate?: (name: string) => void | Promise<void>
  createLabel?: string
  /** Si se pasa, cada opción muestra un botón (x) para borrarla. */
  onDelete?: (value: string) => void | Promise<void>
}

// Reemplaza al <select> nativo: el popup de un <select> lo dibuja el SO, así
// que no hay forma de estilarlo igual que el resto del formulario (ver
// discusión en el PR). Esto es un botón + una lista propia, con el mismo
// fondo/borde/radius que el resto de los inputs.
export default function Select({
  value,
  onChange,
  options,
  placeholder,
  onCreate,
  createLabel = 'Agregar',
  onDelete,
}: SelectProps) {
  const [open, setOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
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

  useEffect(() => {
    if (!open) {
      setCreating(false)
      setNewName('')
    }
  }, [open])

  const selected = options.find((o) => o.value === value)

  async function commitCreate() {
    const name = newName.trim()
    if (!name || !onCreate) return
    await onCreate(name)
    setNewName('')
    setCreating(false)
  }

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
              <span className="select-option-label">{opt.label}</span>
              {onDelete && (
                <button
                  type="button"
                  className="select-option-delete"
                  aria-label={`Borrar ${opt.label}`}
                  onClick={(e) => {
                    e.stopPropagation()
                    onDelete(opt.value)
                  }}
                >
                  <IconX size={12} />
                </button>
              )}
            </li>
          ))}
          {onCreate &&
            (creating ? (
              <li className="select-create-row" onClick={(e) => e.stopPropagation()}>
                <input
                  autoFocus
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      commitCreate()
                    }
                    if (e.key === 'Escape') {
                      setCreating(false)
                      setNewName('')
                    }
                  }}
                  placeholder="Nombre"
                />
                <button type="button" onClick={commitCreate} aria-label="Confirmar">
                  <IconPlus size={14} />
                </button>
              </li>
            ) : (
              <li
                className="select-create-trigger"
                onClick={(e) => {
                  e.stopPropagation()
                  setCreating(true)
                }}
              >
                <IconPlus size={14} /> {createLabel}
              </li>
            ))}
        </ul>
      )}
    </div>
  )
}
