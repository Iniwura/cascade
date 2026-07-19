import { useEffect, useRef, useState } from 'react'
import { readContract } from '../lib/gl.js'
import { parseTree, rootIdOf, flatten, BANDS } from '../lib/tree.js'
import { getKnownJobs } from '../lib/jobIndex.js'

const SNAP_KEY = (a) => 'cascade:snapshot:' + a
const NOTE_KEY = (a) => 'cascade:notifications:' + a

function loadJSON(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback } catch (e) { return fallback }
}
function saveJSON(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)) } catch (e) { /* storage blocked, not fatal */ }
}

// Polls jobs this wallet is involved in and diffs status against what was
// last seen. This is the honest version of a notification system without
// a backend: it only catches changes while the tab is open, closing the
// browser means catching up next visit, not the moment it happens. There
// is no push path here, that would need infrastructure this project
// doesn't have.
export function useNotifications(account) {
  const [notes, setNotes] = useState([])
  const timer = useRef(null)

  useEffect(() => {
    if (!account) { setNotes([]); return }
    setNotes(loadJSON(NOTE_KEY(account), []))

    const tick = async () => {
      let ids = []
      try {
        const raw = await readContract('list_roots', [])
        const parsed = raw ? JSON.parse(raw) : []
        if (Array.isArray(parsed) && parsed.length) ids = parsed
      } catch (e) { /* fine */ }
      if (!ids.length) ids = getKnownJobs()

      const snapshot = loadJSON(SNAP_KEY(account), {})
      const nextSnapshot = {}
      const fresh = []

      for (const id of ids) {
        let flat
        try {
          const raw = await readContract('get_tree', [id])
          flat = parseTree(raw)
        } catch (e) { continue }
        if (!flat) continue

        const rows = flatten(flat, rootIdOf(flat))
        const mine = rows.filter(r => r.task.agent === account || r.task.buyer === account)
        if (!mine.length) continue

        for (const { id: tid, task } of mine) {
          const key = id + ':' + tid
          const prev = snapshot[key]
          nextSnapshot[key] = { status: task.status, agent: task.agent, score: task.score }

          if (!prev) continue // first time seeing this task, no notification, just baseline it
          if (prev.status === task.status && prev.agent === task.agent) continue

          let msg = null
          if (prev.agent === '' && task.agent !== '' && task.buyer === account)
            msg = 'Job #' + tid + ' was claimed by ' + task.agent.slice(0, 8) + '...'
          else if (prev.status === 'posted' && task.status === 'submitted' && task.buyer === account)
            msg = 'Work submitted on your job #' + tid
          else if (prev.status === 'submitted' && task.status === 'resolved')
            msg = 'Job #' + tid + ' resolved: ' + (BANDS[task.score] || task.score)
          else if (prev.status !== task.status)
            msg = 'Job #' + tid + ' is now ' + task.status

          if (msg) fresh.push({ id: key + ':' + Date.now(), jobId: id, text: msg, ts: Date.now(), read: false })
        }
      }

      saveJSON(SNAP_KEY(account), nextSnapshot)
      if (fresh.length) {
        setNotes(cur => {
          const merged = [...fresh, ...cur].slice(0, 40)
          saveJSON(NOTE_KEY(account), merged)
          return merged
        })
      }
    }

    tick()
    timer.current = setInterval(tick, 15000)
    return () => clearInterval(timer.current)
  }, [account])

  const markAllRead = () => {
    setNotes(cur => {
      const merged = cur.map(n => ({ ...n, read: true }))
      if (account) saveJSON(NOTE_KEY(account), merged)
      return merged
    })
  }

  const unread = notes.filter(n => !n.read).length
  return { notes, unread, markAllRead }
}
