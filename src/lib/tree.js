// Turning get_tree output into something printable.
//
// get_tree returns every task in the subtree keyed by id, flat. One call
// for the whole view; do not walk get_task per node.

export const BANDS = {
  95: 'FULL',
  80: 'MINOR_GAPS',
  55: 'PARTIAL',
  25: 'TANGENTIAL',
  5:  'UNRELATED',
}

export const BAR_WIDTH = 20

// The bar is the whole interface. Length is the payout, drawn in one
// hue: filled is money that reached the agent, empty is money that went
// back. Never colour by band.
export function bar(score) {
  if (score < 0) return { filled: 0, empty: BAR_WIDTH }
  const filled = Math.round((score / 100) * BAR_WIDTH)
  return { filled, empty: BAR_WIDTH - filled }
}

export function parseTree(raw) {
  if (!raw) return null
  let flat
  try {
    flat = typeof raw === 'string' ? JSON.parse(raw) : raw
  } catch (e) {
    return null
  }
  if (!flat || typeof flat !== 'object') return null
  const ids = Object.keys(flat)
  if (!ids.length) return null
  return flat
}

export function rootIdOf(flat) {
  return Object.keys(flat).find(id => flat[id].parent_id === '') || Object.keys(flat)[0]
}

// Depth-first, children in id order, so the printed tree is stable
// between renders. isLast picks the connector: a middle child gets
// a tee, the final one gets an elbow.
export function flatten(flat, rootId, depth = 0, out = [], isLast = true) {
  const t = flat[rootId]
  if (!t) return out
  out.push({ id: rootId, depth, task: t, isLast })
  const kids = [...(t.children || [])].sort((a, b) => Number(a) - Number(b))
  kids.forEach((cid, i) => flatten(flat, cid, depth + 1, out, i === kids.length - 1))
  return out
}

// The ledger. This is the product's whole claim, so it is computed from
// on-chain figures only and never from anything the UI is holding.
export function ledger(flat) {
  const rootId = rootIdOf(flat)
  const root = flat[rootId]
  const rows = flatten(flat, rootId)

  const escrowed = Number(root.payout_allocated)

  let earned = 0
  let pooled = 0
  for (const { task } of rows) {
    if (task.status === 'resolved') {
      earned += Number(task.realized)
      pooled += Number(task.self_allocated) - Number(task.realized)
    }
  }

  // Shortfall waits at the root. It only leaves the tree when the root
  // resolves, so a sibling still in flight can never be shortchanged.
  const rootResolved = root.status === 'resolved'
  const returned = rootResolved ? pooled : 0
  const held = escrowed - earned - returned

  const balanced =
    rootResolved && Math.abs(earned + returned - escrowed) < 1e6 // sub-wei float slop

  return {
    rootId,
    escrowed,
    earned,
    returned,
    pooled: rootResolved ? 0 : pooled,
    held: held < 0 ? 0 : held,
    rootResolved,
    balanced,
  }
}
