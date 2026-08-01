import React, { useEffect, useState } from 'react'
import { readContract, short } from '../lib/gl.js'

// Plain storage, no AI, no consensus call, deliberately, this is a cheap
// clarification channel between the two people already on a task, not
// general chat. Gated to buyer/agent server-side by the contract itself;
// this component just doesn't show a send box to anyone else, matching
// that gate rather than trying to enforce it a second time client-side.
export default function Messages({ taskId, account, isParty, onSend, sending }) {
  const [msgs, setMsgs] = useState([])
  const [loading, setLoading] = useState(true)
  const [text, setText] = useState('')

  const load = () => {
    setLoading(true)
    readContract('get_messages', [taskId])
      .then(raw => { try { setMsgs(raw ? JSON.parse(raw) : []) } catch (e) { setMsgs([]) } })
      .catch(() => setMsgs([]))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [taskId])

  const send = () => {
    const t = text.trim()
    if (!t) return
    onSend(taskId, t, () => { setText(''); load() })
  }

  if (loading) return null
  if (!msgs.length && !isParty) return null

  return (
    <div className="msg-thread">
      {msgs.length > 0 && (
        <div className="msg-label">Messages ({msgs.length})</div>
      )}
      {msgs.map((m, i) => (
        <div key={i} className={'msg-bubble' + (m.sender === account ? ' mine' : '')}>
          <span className="msg-sender">{short(m.sender)}</span>
          <span className="msg-text">{m.text}</span>
        </div>
      ))}
      {isParty && (
        <div className="msg-input-row">
          <input
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') send() }}
            placeholder="Ask a question or add context (up to 500 characters)"
          />
          <button className="btn-sm" onClick={send} disabled={!!sending || !text.trim()}>
            {sending || 'Send'}
          </button>
        </div>
      )}
    </div>
  )
}
