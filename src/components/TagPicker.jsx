import React from 'react'
import { SKILL_TAGS } from '../lib/tags.js'

// Click to toggle, not free text. A picker instead of an input means
// "solidity", "Solidity", and "smart contracts" can never end up as
// three different tags on three different jobs.
export default function TagPicker({ value, onChange, label }) {
  const selected = (value || '').split(',').map(t => t.trim()).filter(Boolean)

  const toggle = (tag) => {
    const next = selected.includes(tag) ? selected.filter(t => t !== tag) : [...selected, tag]
    onChange(next.join(','))
  }

  return (
    <div className="form-row">
      {label && <label>{label}</label>}
      <div className="tag-picker">
        {SKILL_TAGS.map(tag => (
          <button
            key={tag}
            type="button"
            className={'tag-option' + (selected.includes(tag) ? ' on' : '')}
            onClick={() => toggle(tag)}
          >
            {tag}
          </button>
        ))}
      </div>
    </div>
  )
}
