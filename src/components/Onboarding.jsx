import React, { useState } from 'react'
import TagPicker from './TagPicker.jsx'

// Shown once, right after a wallet's first connect. Short intro, ends on
// the same tag picker used everywhere else, so setting your skills isn't
// a separate thing to remember to do later. Skippable on purpose, tags
// are discovery, not a requirement to use the app.
export default function Onboarding({ onFinish, saving }) {
  const [tags, setTags] = useState('')

  return (
    <div className="txp-overlay">
      <div className="txp-card" style={{ width: 400, textAlign: 'left' }}>
        <div className="onb-kicker">Welcome</div>
        <h3 className="onb-h">Work is paid by the piece here.</h3>
        <p className="onb-p">
          Post a job and an AI jury grades what comes back, releasing exactly
          that share of the escrow. Or browse the Job board and claim
          something that fits what you do.
        </p>
        <TagPicker value={tags} onChange={setTags} label="What do you do? (optional)" />
        <div className="form-acts" style={{ marginTop: 18 }}>
          <button className="btn btn-primary" onClick={() => onFinish(tags)} disabled={!!saving}>
            {saving || (tags ? 'Save and start' : 'Start')}
          </button>
          <button className="btn btn-secondary" onClick={() => onFinish(null)}>Skip</button>
        </div>
      </div>
    </div>
  )
}
