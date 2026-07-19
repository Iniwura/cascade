import React, { useEffect, useState } from 'react'
import JobCard from './JobCard.jsx'
import { rootIdOf, flatten } from '../lib/tree.js'
import { readContract } from '../lib/gl.js'
import { parseTree } from '../lib/tree.js'
import { getKnownJobs } from '../lib/jobIndex.js'

// Every task on the protocol, grouped by where it actually is, walking
// the FULL tree of every job, not just its root. A subcontracted piece
// posted open (agent "") is exactly as claimable as a root job, and was
// invisible here before this rewrote, since only root-level agent/status
// was ever checked. Each node gets its own card now, tagged with which
// root it belongs to for navigation.
export default function JobBoard({ onOpen, reloadKey }) {
  const [trees, setTrees] = useState({})
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setFailed(false)
    ;(async () => {
      let ids = []
      try {
        const raw = await readContract('list_roots', [])
        const parsed = raw ? JSON.parse(raw) : []
        if (Array.isArray(parsed) && parsed.length) ids = parsed
      } catch (e) { /* older contract, no list_roots yet */ }
      if (!ids.length) ids = getKnownJobs()

      const pairs = await Promise.all(ids.map(async id => {
        try {
          const raw = await readContract('get_tree', [id])
          return [id, parseTree(raw)]
        } catch (e) { return [id, null] }
      }))
      if (cancelled) return
      const map = {}
      let anyFailed = false
      for (const [id, tree] of pairs) { if (tree) map[id] = tree; else if (ids.length) anyFailed = true }
      setTrees(map)
      setFailed(anyFailed && Object.keys(map).length === 0 && ids.length > 0)
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [reloadKey])

  // Flatten every tree into individual nodes: {rootId, taskId, task}.
  const nodes = []
  for (const [rid, f] of Object.entries(trees)) {
    for (const row of flatten(f, rootIdOf(f))) nodes.push({ rootId: rid, taskId: row.id, task: row.task })
  }

  const open = nodes.filter(n => n.task.agent === '' && n.task.status === 'posted')
  const settled = nodes.filter(n => ['resolved', 'reclaimed'].includes(n.task.status))
  const inProgress = nodes.filter(n =>
    !['resolved', 'reclaimed'].includes(n.task.status) && !(n.task.agent === '' && n.task.status === 'posted')
  )

  if (loading) return <p style={{ color: 'var(--ink-faint)', fontSize: 13 }}>Loading jobs from chain...</p>
  if (failed) return <p style={{ color: 'var(--ink-faint)', fontSize: 13 }}>Could not read jobs from chain right now. Try refreshing.</p>
  if (!nodes.length) return <p style={{ color: 'var(--ink-faint)', fontSize: 13 }}>Nothing posted yet. Be the first.</p>

  const Group = ({ label, items }) => (
    <>
      <div className="dash-group-label">{label} ({items.length})</div>
      {items.length === 0
        ? <p style={{ color: 'var(--ink-faint)', fontSize: 13, marginBottom: 32 }}>Nothing here right now.</p>
        : <div className="job-grid" style={{ marginBottom: 40 }}>
            {items.map(n => (
              <JobCard key={n.rootId + ':' + n.taskId} taskId={n.taskId} task={n.task} rootId={n.rootId} onOpen={onOpen} />
            ))}
          </div>}
    </>
  )

  return (
    <>
      <Group label="Open, waiting to be claimed" items={open} />
      <Group label="In progress" items={inProgress} />
      <Group label="Settled" items={settled} />
    </>
  )
}
