import { useEffect, useId, useRef, useState } from 'react'
import { Menu, X } from 'lucide-react'

export interface MobileMenuItem {
  href: string
  label: string
  current?: boolean
}

/** Compact navigation for phone screens, with keyboard and outside-click support. */
export function MobileMenu({ items }: { items: MobileMenuItem[] }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuId = useId()

  useEffect(() => {
    if (!open) return
    const closeOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      setOpen(false)
      buttonRef.current?.focus()
    }
    document.addEventListener('pointerdown', closeOutside)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOutside)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])

  useEffect(() => {
    const desktop = window.matchMedia('(min-width: 901px)')
    const closeOnDesktop = () => {
      if (desktop.matches) setOpen(false)
    }
    desktop.addEventListener('change', closeOnDesktop)
    return () => desktop.removeEventListener('change', closeOnDesktop)
  }, [])

  return (
    <div className="mobile-menu" ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        className="mobile-menu__toggle"
        aria-label={open ? 'Close navigation menu' : 'Open navigation menu'}
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((current) => !current)}
      >
        {open ? <X size={20} aria-hidden="true" /> : <Menu size={20} aria-hidden="true" />}
        <span className="mobile-menu__label">Menu</span>
      </button>
      {open && (
        <nav className="mobile-menu__panel" id={menuId} aria-label="Mobile primary">
          {items.map((item) => (
            <a
              key={item.href}
              href={item.href}
              aria-current={item.current ? 'page' : undefined}
              onClick={() => setOpen(false)}
            >
              {item.label}
            </a>
          ))}
        </nav>
      )}
    </div>
  )
}
