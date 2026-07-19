import React, { useState } from 'react'
import TagPicker from './TagPicker.jsx'

// Username and skills, moved out of Dashboard's main flow and behind a
// deliberate edit action instead of sitting inline permanently.
//
// Honest limit stated here, not hidden: tags can be cleared, that's just
// saving an empty string. A username cannot be removed once claimed,
// set_username requires 3-20 characters, there is no unset path in the
// contract, only renaming to something else.
export default function ProfileSettings({ username, tags, onSaveUsername, onSaveTags, savingUsername, savingTags, onClose }) {
  const [name, setName] = useState(username || '')
  const [t, setT] = useState(tags || '')

  return (
    <div className="txp-overlay" onClick={onClose}>
      <div className="txp-card" style={{ width: 420, textAlign: 'left' }} onClick={e => e.stopPropagation()}>
        <div className="onb-kicker">Profile</div>
        <h3 className="onb-h" style={{ marginBottom: 20 }}>Your details</h3>

        <div className="form-row">
          <label>Username</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="3-20 characters" />
            <button className="btn-sm" onClick={() => onSaveUsername(name)} disabled={!!savingUsername}>
              {savingUsername || (username ? 'Rename' : 'Claim')}
            </button>
          </div>
          <p className="settings-note">
            {username
              ? 'Cannot be removed once claimed, only renamed to something else.'
              : 'Others can hand off work to you by typing this instead of your address.'}
          </p>
        </div>

        <TagPicker value={t} onChange={setT} label="Skills" />
        <p className="settings-note">Discovery only, not verified, click a tag again to remove it.</p>
        <div className="form-acts" style={{ marginTop: 14 }}>
          <button className="btn-sm" onClick={() => onSaveTags(t)} disabled={!!savingTags}>{savingTags || 'Save skills'}</button>
        </div>

        <div className="form-acts" style={{ marginTop: 22 }}>
          <button className="btn btn-secondary" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  )
}
