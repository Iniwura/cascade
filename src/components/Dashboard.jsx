import React, { useEffect, useState } from 'react'
import JobCard from './JobCard.jsx'
import ProfileSettings from './ProfileSettings.jsx'
import { flatten, rootIdOf, ledger } from '../lib/tree.js'
import { readContract, fmt, short } from '../lib/gl.js'
import { parseTree } from '../lib/tree.js'
import { getKnownJobs } from '../lib/jobIndex.js'

export default function Dashboard({ account, onOpen, onSaveTags, savingTags, onSaveUsername, savingUsername }) {
  const [trees, setTrees] = useState({})
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [myTags, setMyTags] = useState('')
  const [myUsername, setMyUsername] = useState('')
  const [showSettings, setShowSettings] = useState(false)

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

      if (account) {
        try {
          const t = await readContract('get_agent_tags', [account])
          if (!cancelled && t) setMyTags(t)
        } catch (e) { /* fine, start blank */ }
        try {
          const u = await readContract('get_username', [account])
          if (!cancelled && u) setMyUsername(u)
        } catch (e) { /* fine, start blank */ }
      }
    })()
    return () => { cancelled = true }
  }, [account])

  const entries = Object.entries(trees)

  // Posted by you: buyer relationship is always root-level, a buyer never
  // "owns" a subtask separately from owning the whole tree.
  const posted = account ? entries.filter(([, f]) => f[rootIdOf(f)].buyer === account) : []

  // Assigned to you: the SPECIFIC node where you're the agent, which may
  // be a child several levels down, not the tree's root. An earlier
  // version filtered which TREES contained an assignment to you but then
  // always displayed the root's own spec/status/score regardless, so a
  // buried assignment showed the wrong job entirely.
  const assignedNodes = account
    ? entries.flatMap(([rid, f]) => {
        if (f[rootIdOf(f)].buyer === account) return []
        return flatten(f, rootIdOf(f))
          .filter(r => r.task.agent === account)
          .map(r => ({ rootId: rid, taskId: r.id, task: r.task }))
      })
    : []

  const buyerNodes = posted.flatMap(([rid, f]) =>
    flatten(f, rootIdOf(f)).map(row => ({ rootId: rid, taskId: row.id, task: row.task, flat: f }))
  )
  const awaitingDelegation = buyerNodes.filter(n => n.task.status === 'proposed')
  const awaitingResolution = buyerNodes.filter(n =>
    n.task.status === 'submitted' &&
    (n.task.children || []).every(c => ['resolved', 'reclaimed'].includes(n.flat[c]?.status))
  )

  // Buyer-side: money that moved on jobs YOU posted.
  let postedResolved = 0, postedPending = 0, totalEscrowed = 0, earnedByYourAgents = 0, returnedToYou = 0
  for (const [, f] of posted) {
    const root = f[rootIdOf(f)]
    const L = ledger(f)
    totalEscrowed += L.escrowed
    if (L.rootResolved) {
      postedResolved++
      earnedByYourAgents += L.earned
      returnedToYou += L.returned
    } else if (root.status === 'reclaimed') {
      // Reclaimed is settled too, buyer took the whole escrow back before
      // any agent earned a share of it, not "pending" like a live job.
      postedResolved++
      returnedToYou += L.escrowed
    } else {
      postedPending++
    }
  }

  // Agent-side: what YOU personally earned on jobs assigned to you. This
  // is a genuinely different number from earnedByYourAgents above, that
  // one is what people you hired earned, this one is what you earned
  // doing the work yourself. An earlier version only ever computed the
  // buyer-side numbers, so a wallet that had only ever been an agent saw
  // a flat 0 across the board regardless of real earnings.
  let assignedResolved = 0, assignedPending = 0, earnedByYou = 0
  for (const n of assignedNodes) {
    if (n.task.status === 'resolved') { assignedResolved++; earnedByYou += Number(n.task.realized) }
    else if (n.task.status !== 'reclaimed') assignedPending++
  }

  const resolvedCount = postedResolved + assignedResolved
  const pendingCount = postedPending + assignedPending

  const saveTags = (t) => { onSaveTags && onSaveTags(t); setMyTags(t) }
  const saveUsername = (n) => { onSaveUsername && onSaveUsername(n); setMyUsername(n) }

  return (
    <section className="section container">
      <div className="section-head">
        <div className="section-kicker">dashboard</div>
        <h2 className="section-h">What's yours.</h2>
        <p className="section-p">
          Only jobs you posted or were assigned. Everything on the protocol lives on the Job board instead.
        </p>
      </div>

      {!account && (
        <p style={{ color: 'var(--ink-faint)', fontSize: 13, marginBottom: 24 }}>
          Connect a wallet to see your jobs.
        </p>
      )}

      {failed && (
        <p style={{ color: 'var(--ink-faint)', fontSize: 13, marginBottom: 24 }}>
          Could not read jobs from chain right now. Try refreshing.
        </p>
      )}

      {account && (
        <>
          {!loading && awaitingResolution.length > 0 && (
            <div className="resolve-banner">
              <div className="resolve-banner-head">
                <strong>{awaitingResolution.length} job{awaitingResolution.length > 1 ? 's' : ''} waiting for you to resolve.</strong>
                <span>You can resolve now; after the deadline, settlement becomes permissionless.</span>
              </div>
              <div className="job-grid">
                {awaitingResolution.map(n => (
                  <JobCard key={n.rootId + ':' + n.taskId} taskId={n.taskId} task={n.task} rootId={n.rootId} role="buyer" roleLabel="ready to resolve" onOpen={onOpen} />
                ))}
              </div>
            </div>
          )}

          {!loading && awaitingDelegation.length > 0 && (
            <div className="resolve-banner">
              <div className="resolve-banner-head">
                <strong>{awaitingDelegation.length} delegation proposal{awaitingDelegation.length > 1 ? 's' : ''} waiting for your approval.</strong>
                <span>No allocation moves until you approve the exact proposed terms.</span>
              </div>
              <div className="job-grid">
                {awaitingDelegation.map(n => (
                  <JobCard key={n.rootId + ':' + n.taskId} taskId={n.taskId} task={n.task} rootId={n.rootId} role="buyer" roleLabel="approval required" onOpen={onOpen} />
                ))}
              </div>
            </div>
          )}

          <div className="stats" style={{ marginTop: 0, marginBottom: 44 }}>
            <div className="stat">
              <div className="stat-num">{resolvedCount + pendingCount}<span className="u">jobs</span></div>
              <div className="stat-lbl">{resolvedCount} settled, {pendingCount} pending</div>
            </div>
            <div className="stat">
              <div className="stat-num mono" style={{ fontSize: 24 }}>{fmt(totalEscrowed)}</div>
              <div className="stat-lbl">GEN escrowed as buyer, {fmt(returnedToYou)} returned</div>
            </div>
            <div className="stat">
              <div className="stat-num mono earned" style={{ fontSize: 24 }}>{fmt(earnedByYou)}</div>
              <div className="stat-lbl">GEN you earned as an agent</div>
            </div>
          </div>

          <div className="profile-bar">
            <div className="profile-bar-left">
              <span className="profile-bar-name">{myUsername ? '@' + myUsername : short(account)}</span>
              {myTags.split(',').map(t => t.trim()).filter(Boolean).length > 0 && (
                <div className="profile-bar-tags">
                  {myTags.split(',').map(t => t.trim()).filter(Boolean).map(t => <span key={t} className="tag-chip">{t}</span>)}
                </div>
              )}
            </div>
            <button className="btn-sm" onClick={() => setShowSettings(true)}>Edit profile</button>
          </div>

          {showSettings && (
            <ProfileSettings
              username={myUsername}
              tags={myTags}
              onSaveUsername={saveUsername}
              onSaveTags={saveTags}
              savingUsername={savingUsername}
              savingTags={savingTags}
              onClose={() => setShowSettings(false)}
            />
          )}

          {loading ? (
            <p style={{ color: 'var(--ink-faint)', fontSize: 13 }}>Loading your jobs from chain...</p>
          ) : (
            <>
              <div className="dash-group-label">Posted by you</div>
              {posted.length === 0
                ? <p style={{ color: 'var(--ink-faint)', fontSize: 13, marginBottom: 32 }}>You haven't posted a job yet.</p>
                : <div className="job-grid" style={{ marginBottom: 40 }}>
                    {posted.map(([id, f]) => (
                      <JobCard key={id} taskId={id} task={f[id]} rootId={id} role="buyer" onOpen={onOpen} />
                    ))}
                  </div>}

              <div className="dash-group-label">Assigned to you</div>
              {assignedNodes.length === 0
                ? <p style={{ color: 'var(--ink-faint)', fontSize: 13 }}>Nothing assigned to this wallet yet.</p>
                : <div className="job-grid">
                    {assignedNodes.map(n => (
                      <JobCard key={n.rootId + ':' + n.taskId} taskId={n.taskId} task={n.task} rootId={n.rootId} role="agent" onOpen={onOpen} />
                    ))}
                  </div>}
            </>
          )}
        </>
      )}
    </section>
  )
}
