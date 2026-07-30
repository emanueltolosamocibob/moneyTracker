import type { ReactNode } from 'react'

export default function Modal({ children, wide }: { children: ReactNode; wide?: boolean }) {
  return (
    <div className="modal-overlay">
      <div className={`modal-panel${wide ? ' modal-panel-wide' : ''}`}>{children}</div>
    </div>
  )
}
