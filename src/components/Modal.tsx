import type { ReactNode } from 'react'

export default function Modal({ children, wide, scroll }: { children: ReactNode; wide?: boolean; scroll?: boolean }) {
  return (
    <div className="modal-overlay">
      <div className={`modal-panel gradient-bg${wide ? ' modal-panel-wide' : ''}${scroll ? ' modal-panel-scroll' : ''}`}>
        {children}
      </div>
    </div>
  )
}
