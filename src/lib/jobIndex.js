// The deployed contract has no way to list every job that exists, that
// needs a new view method and a redeploy, which is scheduled but not
// done yet. Until then, this tracks jobs THIS browser has created or
// opened, so the dashboard has something real to show rather than
// forcing a manual id lookup for every job past the seeded demo.
//
// Deliberately honest about scope: this is "jobs I've seen," not "every
// job on the protocol." The dashboard says so.
const KEY = 'cascade:known_jobs'
const MAX = 60

export function getKnownJobs() {
  try {
    const raw = localStorage.getItem(KEY)
    const list = raw ? JSON.parse(raw) : []
    return Array.isArray(list) ? list : []
  } catch (e) {
    return []
  }
}

export function addKnownJob(id) {
  if (!id) return
  try {
    const list = getKnownJobs().filter(x => x !== id)
    list.unshift(id)
    localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)))
  } catch (e) { /* storage blocked (private mode etc), not fatal */ }
}
