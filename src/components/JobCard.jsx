import React from 'react'
import { Vessel } from './Cascade.jsx'
import { BANDS } from '../lib/tree.js'
import { fmt, short } from '../lib/gl.js'
import DeliverablePreview from './DeliverablePreview.jsx'

// Operates on ONE specific task node, by id, not always "the root of this
// tree." An earlier version always read rootIdOf(flat) internally, which
// meant a subcontracted piece someone posted open was invisible on the
// board (only root-level open/claimed state was ever checked), and a
// Dashboard "assigned to you" card showed the ROOT's spec and status even
// when the account was actually assigned to a child several levels down.
// rootId is kept separately, purely for navigation, clicking any card
// opens that job's full tree in context.
//
// role, when given ('buyer' | 'agent'), changes what's emphasized: a
// buyer wants to see what they got for their money (the deliverable,
// the reasoning, what came back), an agent wants to see how they scored
// and what they earned. Same data, different framing.
export default function JobCard({ taskId, task, rootId, role, roleLabel, onOpen }) {
  const isOpen = task.agent === '' && task.status === 'posted'
  const isChild = task.parent_id !== ''
  const resolved = task.status === 'resolved'
  const tags = (task.tags || '').split(',').map(t => t.trim()).filter(Boolean)
  const urls = (task.deliverable_url || '').split(',').map(u => u.trim()).filter(Boolean)

  return (
    <div
      className="job-card"
      role="button"
      tabIndex={0}
      onClick={() => onOpen(rootId)}
      onKeyDown={e => { if (e.key === 'Enter') onOpen(rootId) }}
    >
      <div className="job-card-top">
        <span className="card-id">#{taskId}{isChild && <span className="job-card-piece"> (piece of #{rootId})</span>}</span>
        {isOpen
          ? <span className="verdict-badge open-badge">OPEN</span>
          : <span className={'verdict-badge ' + (resolved ? 'done' : 'pending')}>
              {resolved ? (BANDS[task.score] || task.score) : task.status}
            </span>}
      </div>
      <p className="job-card-spec">{task.spec}</p>
      {tags.length > 0 && (
        <div className="card-tags" style={{ marginTop: 0 }}>
          {tags.map(t => <span key={t} className="tag-chip">{t}</span>)}
        </div>
      )}
      <Vessel score={resolved ? task.score : -1} />

      {/* Buyer view: lead with the outcome, what did the money buy. A
          real preview, not just a link, that's the thing a buyer actually
          wants to see first. stopPropagation on the wrapper keeps a click
          on the preview's own link from also triggering card navigation. */}
      {role === 'buyer' && resolved && (
        <div className="job-card-outcome" onClick={e => e.stopPropagation()}>
          <DeliverablePreview urls={urls} maxChars={280} />
          {task.reasoning && <p className="job-card-reasoning">&ldquo;{task.reasoning}&rdquo;</p>}
        </div>
      )}

      <div className="job-card-foot">
        {role === 'agent' && resolved
          ? <span className="mono earned">earned {fmt(task.realized)} GEN</span>
          : role === 'buyer' && resolved
            ? <span className="mono returned">{fmt(Number(task.self_allocated) - Number(task.realized))} GEN returned</span>
            : <span className="mono">{fmt(task.payout_allocated)} GEN</span>}
        {roleLabel && <span className="job-card-role">{roleLabel}</span>}
        {!roleLabel && task.agent && !isOpen && <span className="job-card-role">{short(task.agent)}</span>}
      </div>
    </div>
  )
}
