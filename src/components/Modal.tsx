import type { ReactNode } from 'react'

export default function Modal({ children }: { children: ReactNode }) {
  return (
    <div className="modal-overlay">
      <div className="modal-panel">{children}</div>
    </div>
  )
}
