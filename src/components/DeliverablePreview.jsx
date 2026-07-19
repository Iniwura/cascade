import React, { useEffect, useState } from 'react'

// Fetches and renders the actual deliverable content, not just a link.
// Confirmed against a real header check: raw.githubusercontent.com, the
// domain every deliverable in this app has used so far, sends
// access-control-allow-origin: *, so a plain browser fetch can read it.
// That header is GitHub's choice, not a guarantee, most ordinary web
// pages don't set it, so this fails closed: try to fetch, and if the
// browser blocks it (CORS, network, anything), fall back to a plain
// link instead of an error state. There's no way to distinguish "CORS
// blocked" from "genuinely offline" from inside a failed fetch, so the
// fallback copy stays deliberately non-specific about which happened.
function OnePreview({ url, maxChars }) {
  const [state, setState] = useState('loading') // loading | ok | blocked
  const [content, setContent] = useState('')

  useEffect(() => {
    let cancelled = false
    setState('loading')
    fetch(url)
      .then(r => { if (!r.ok) throw new Error('bad status'); return r.text() })
      .then(text => { if (!cancelled) { setContent(text); setState('ok') } })
      .catch(() => { if (!cancelled) setState('blocked') })
    return () => { cancelled = true }
  }, [url])

  const short = url.length > 60 ? url.slice(0, 57) + '...' : url

  if (state === 'loading') {
    return <div className="deliv-box deliv-loading">Loading preview...</div>
  }
  if (state === 'blocked') {
    return (
      <div className="deliv-box deliv-blocked">
        <span>Preview unavailable for this link.</span>
        <a href={url} target="_blank" rel="noreferrer">{short} ↗</a>
      </div>
    )
  }
  const truncated = content.length > maxChars
  return (
    <div className="deliv-box">
      <pre className="deliv-code">{content.slice(0, maxChars)}{truncated ? '\n...' : ''}</pre>
      <a className="deliv-link" href={url} target="_blank" rel="noreferrer">{short} ↗</a>
    </div>
  )
}

export default function DeliverablePreview({ urls, maxChars = 600 }) {
  const list = (urls || []).filter(Boolean)
  if (!list.length) return null
  return (
    <div className="deliv-stack">
      {list.map(u => <OnePreview key={u} url={u} maxChars={maxChars} />)}
    </div>
  )
}
