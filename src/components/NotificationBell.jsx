import React, { useState } from 'react'

export default function NotificationBell({ notes, unread, onOpenNote, onMarkRead }) {
  const [open, setOpen] = useState(false)

  const toggle = () => {
    setOpen(o => !o)
    if (!open) onMarkRead()
  }

  return (
    <div style={{ position: 'relative' }}>
      <button className="bell-btn" onClick={toggle} aria-label="Notifications">
        <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 8a6 6 0 0 0-12 0c0 5-2 6-2 6h16s-2-1-2-6" />
          <path d="M10.5 20a1.5 1.5 0 0 0 3 0" />
        </svg>
        {unread > 0 && <span className="bell-badge">{unread > 9 ? '9+' : unread}</span>}
      </button>

      {open && (
        <>
          <div className="bell-scrim" onClick={() => setOpen(false)} />
          <div className="bell-panel">
            <div className="bell-panel-head">Notifications</div>
            {notes.length === 0 ? (
              <div className="bell-empty">Nothing yet. Only catches changes while this tab is open.</div>
            ) : (
              notes.map(n => (
                <button key={n.id} className="bell-item" onClick={() => { onOpenNote(n.jobId); setOpen(false) }}>
                  <span>{n.text}</span>
                  <span className="bell-time">{new Date(n.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                </button>
              ))
            )}
          </div>
        </>
      )}
    </div>
  )
}
