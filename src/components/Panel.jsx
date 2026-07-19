import React, { useState } from 'react'
import { IconCopy } from './Icons.jsx'
import { short, EXPLORER, CONTRACT } from '../lib/gl.js'

// Real product chrome: a title, a live badge that's true (not decorative),
// and the contract address as a working link, with a copy action for the
// whole panel's underlying data. This is meant to read as an application
// panel, because it is one, not as a marketing device styled to look
// like one.
export default function Panel({ title, live, children, foot, raw }) {
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(raw || '')
      setCopied(true)
      setTimeout(() => setCopied(false), 1300)
    } catch (e) { /* clipboard blocked, not worth surfacing */ }
  }

  return (
    <div className="panel">
      <div className="panel-head">
        <div className="panel-title">
          {title}
          {live && <span className="live-pill"><span className="live-dot" />live</span>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <a className="panel-addr" href={EXPLORER} target="_blank" rel="noreferrer">{short(CONTRACT)}</a>
          {raw && (
            <button className="panel-addr" onClick={copy} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ width: 12, height: 12, display: 'inline-block' }}><IconCopy /></span>
              {copied ? 'copied' : 'copy'}
            </button>
          )}
        </div>
      </div>
      <div className="panel-body">{children}</div>
      {foot && <div className="panel-foot">{foot}</div>}
    </div>
  )
}
