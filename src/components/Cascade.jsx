import React, { useEffect, useRef, useState } from 'react'
import { fmt, short } from '../lib/gl.js'
import { BANDS, flatten, rootIdOf } from '../lib/tree.js'
import DeliverablePreview from './DeliverablePreview.jsx'

// The vessel. Fill length is the payout, period. Amber for what reached
// the agent, the pale slate track underneath for what would return if
// nothing more comes in. This single element carries the product's whole
// claim, so it renders identically here and in the hero illustration.
//
// Rendered at its target width from the first paint, the CSS transition
// on .vessel-fill has nothing to animate FROM and never visibly moves.
// It's mounted at 0 and pushed to the real value a tick later so the
// fill genuinely draws in, and re-triggers if a job resolves live while
// the page is open (score goes from -1 to a real number).
export function Vessel({ score }) {
  const target = score < 0 ? 0 : score
  const [width, setWidth] = useState(0)
  const prevScore = useRef(score)

  useEffect(() => {
    const t = setTimeout(() => setWidth(target), 60)
    return () => clearTimeout(t)
  }, [target])

  useEffect(() => {
    if (prevScore.current !== score && score >= 0) setWidth(0)
    prevScore.current = score
  }, [score])

  return (
    <div className="vessel">
      <div className="vessel-track">
        <div className="vessel-fill" style={{ width: width + '%' }} />
      </div>
      <div className="vessel-pct">{score < 0 ? '\u2013' : target + '%'}</div>
    </div>
  )
}

function TaskCard({ id, task, actions, messages }) {
  const role = task.parent_id === '' ? 'ROOT' : 'HANDED OFF'
  const resolved = task.status === 'resolved'
  const held = Number(task.self_allocated)
  const shortfall = resolved ? held - Number(task.realized) : 0
  const isOpen = task.agent === '' && task.status === 'posted'
  const tags = (task.tags || '').split(',').map(t => t.trim()).filter(Boolean)

  return (
    <div className="card">
      <div className="card-top">
        <div className="card-role">
          <span className="role-badge">{role}</span>
          <span className="card-id">#{id}</span>
          {isOpen && <span className="role-badge open">OPEN</span>}
        </div>
        <span className={'verdict-badge ' + (resolved ? 'done' : 'pending')}>
          {resolved ? (BANDS[task.score] || task.score) : task.status}
        </span>
      </div>

      <p className="card-spec">{task.spec}</p>

      {tags.length > 0 && (
        <div className="card-tags">
          {tags.map(t => <span key={t} className="tag-chip">{t}</span>)}
        </div>
      )}

      <Vessel score={task.score} />

      <div className="card-figures">
        <div><span className="fig-lbl">held  </span><span className="fig-val">{fmt(held)}</span></div>
        {resolved && Number(task.realized) > 0 && (
          <div><span className="fig-lbl">earned  </span><span className="fig-val earned">{fmt(task.realized)}</span></div>
        )}
        {resolved && shortfall > 0 && (
          <div><span className="fig-lbl">pooled  </span><span className="fig-val returned">{fmt(shortfall)}</span></div>
        )}
        {!isOpen && <div><span className="fig-lbl">agent  </span><span className="fig-val">{short(task.agent)}</span></div>}
      </div>

      {resolved && task.deliverable_url && (
        <DeliverablePreview urls={task.deliverable_url.split(',').map(u => u.trim())} maxChars={800} />
      )}
      {resolved && task.reasoning && (
        <div className="card-reasoning">&ldquo;{task.reasoning}&rdquo;</div>
      )}
      {!resolved && task.deliverable_url && (
        <div className="card-url">{task.deliverable_url}</div>
      )}

      {messages && messages(id, task)}

      {actions && <div className="card-acts">{actions(id, task)}</div>}
    </div>
  )
}

function Node({ flat, id, actions, messages }) {
  const task = flat[id]
  if (!task) return null
  const kids = [...(task.children || [])].sort((a, b) => Number(a) - Number(b))
  return (
    <div className="tree-node">
      <TaskCard id={id} task={task} actions={actions} messages={messages} />
      {kids.length > 0 && (
        <div className="tree-children">
          {kids.map(cid => <Node key={cid} flat={flat} id={cid} actions={actions} messages={messages} />)}
        </div>
      )}
    </div>
  )
}

export default function CascadeTree({ flat, actions, messages }) {
  if (!flat) return (
    <p style={{ color: 'var(--ink-faint)', fontSize: 13 }}>
      Nothing here yet. Post the first job to see it appear right here.
    </p>
  )
  const rootId = rootIdOf(flat)
  return <Node flat={flat} id={rootId} actions={actions} messages={messages} />
}
