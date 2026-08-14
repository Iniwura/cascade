// GenLayer client. Real SDK, not hand-built calldata.
//
// This is the wiring proven in production on Gen Markets. Hand-rolling
// the Consensus contract's calldata works for plain method calls but has
// no reliable path for forwarding GEN into gl.message.value: the outer
// transaction is accepted and the contract still reads value as 0.
import { createClient } from 'genlayer-js'
import { testnetBradbury } from 'genlayer-js/chains'
import { TransactionStatus } from 'genlayer-js/types'

export { TransactionStatus }

export const CONTRACT = '0x70aC19F76108e2e4B9256e9DB2972F15b753f509'
export const DEMO_ROOT = '0'

export const CHAIN_ID = '0x107D'
export const NET = {
  chainId: CHAIN_ID,
  chainName: 'GenLayer Bradbury',
  rpcUrls: ['https://rpc-bradbury.genlayer.com'],
  nativeCurrency: { name: 'GEN', symbol: 'GEN', decimals: 18 },
  blockExplorerUrls: ['https://explorer-bradbury.genlayer.com'],
}
export const EXPLORER = 'https://explorer-bradbury.genlayer.com/address/' + CONTRACT

let _client = null

function getClient(account) {
  // Rebuild if the active account changed. The SDK binds the signing
  // account at client-creation time.
  if (!_client || _client._account !== account) {
    _client = createClient({
      chain: testnetBradbury,
      account: account || undefined,
      provider: window.ethereum,
    })
    _client._account = account
  }
  return _client
}

// transactionHashVariant 'latest-nonfinal' is not optional. Without it,
// reads return FINALIZED state only, which lags 30-40 minutes behind
// ACCEPTED during the appeal window. The UI looks broken when it isn't.
export async function readContract(method, args = []) {
  const client = getClient(window._glAccount)
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, 1200 * attempt))
    try {
      const result = await client.readContract({
        address: CONTRACT,
        functionName: method,
        args,
        transactionHashVariant: 'latest-nonfinal',
      })
      if (result === null || result === undefined) return null
      return typeof result === 'string' ? result : JSON.stringify(result)
    } catch (e) {
      if (attempt === 2) throw e
    }
  }
  return null
}

// writeContract only ever resolves to the transaction HASH, confirmed
// against GenLayer's own docs, never the contract method's return value.
// A task_id like "0" or "1" only exists inside the transaction RECEIPT,
// which needs a separate waitForTransactionReceipt call. An earlier
// version of this file guessed the hash itself might sometimes BE the
// return value and guarded on "does this look like a small number",
// which a 66-character hex hash can never satisfy, so that guard failed
// on every single call and the UI never learned a newly created task's id.
//
// onPhase, if given, is called with each real TransactionStatus as the
// SDK reports it: PENDING, PROPOSING, COMMITTING, REVEALING, ACCEPTED.
// These are documented consensus-round states, not estimates.
export async function writeContract(account, method, args = [], value = 0n, onPhase) {
  const client = getClient(account)
  const hash = await client.writeContract({
    address: CONTRACT,
    functionName: method,
    args,
    value: typeof value === 'bigint' ? value : BigInt(value),
    leaderOnly: false,
  })

  // getTransaction is a confirmed, documented call. onStatusUpdate-style
  // callbacks are not confirmed anywhere for this SDK, so real phase
  // tracking polls this directly instead of assuming a callback param
  // that might not exist.
  let poll = null
  if (onPhase) {
    onPhase('PENDING')
    poll = setInterval(async () => {
      try {
        const t = await client.getTransaction({ hash })
        // Never confirmed the exact field name/shape this returns against
        // live GenLayer, this log exists specifically so the next test run
        // tells us the truth instead of another guess.
        console.log('[cascade tx poll]', t)
        if (t?.status) onPhase(t.status)
      } catch (e) {
        console.log('[cascade tx poll] getTransaction failed:', e?.message || e)
      }
    }, 1500)
  }

  let receipt
  try {
    receipt = await client.waitForTransactionReceipt({
      hash,
      status: TransactionStatus.ACCEPTED,
      retries: 100,
      interval: 2500,
    })
  } catch (e) {
    if (poll) clearInterval(poll)
    // The write itself may have succeeded even if waiting for the
    // receipt failed or timed out (slow finality, not a revert). Return
    // what we have rather than claim total failure the caller can't
    // distinguish from a real one.
    return { hash, result: null }
  }
  if (poll) clearInterval(poll)

  // Field name for a plain method's return value isn't consistently
  // documented across sources, probe rather than assume, same discipline
  // already used for the Response object inside the contract itself.
  const result =
    receipt?.data?.result ??
    receipt?.data ??
    receipt?.result ??
    receipt?.output ??
    null

  return { hash, result }
}

// Polls real contract state until checkFn is truthy. More reliable than
// watching transaction status, which can report ACCEPTED on a resolve
// that wrote nothing.
export async function pollForChange(checkFn, { intervalMs = 2500, timeoutMs = 150000 } = {}) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await checkFn()
      if (r) return r
    } catch (e) { /* read errors are transient, keep polling */ }
    await new Promise(res => setTimeout(res, intervalMs))
  }
  throw new Error('still waiting on confirmation · check the explorer')
}

// Wei values exceed JavaScript's safe integer range, so the contract
// takes amount as a string. Passing a number arrives mangled, usually
// as 1. BigInt() throws on a float, hence the round.
// Accepts either a raw 0x address or a username claimed via set_username,
// with or without a leading @, and resolves to a real address either way.
// Blank stays blank, meaning "open, anyone can claim."
export async function resolveAgentInput(input) {
  const v = (input || '').trim()
  if (!v) return ''
  if (isAddress(v)) return v.toLowerCase()
  const name = v.replace(/^@/, '')
  const addr = await readContract('get_address_by_username', [name])
  if (!addr) throw new Error('No wallet found for username "' + name + '"')
  return addr
}

export function isAddress(addr) {
  return typeof addr === 'string' && /^0x[a-fA-F0-9]{40}$/.test(addr.trim())
}

export function genToWeiString(gen) {
  const n = parseFloat(gen)
  if (!isFinite(n) || n <= 0) throw new Error('amount must be greater than zero')
  return BigInt(Math.round(n * 1e18)).toString()
}

// Must match the contract's canonical evidence encoding exactly:
// an ordered JSON array containing each fetched response body, UTF-8 encoded,
// then SHA-256 hashed. URLs are stored separately; the commitment binds the
// bytes the jury will later fetch and grade.
export async function createEvidenceCommitment(urls) {
  const contents = []
  for (const url of urls) {
    const response = await fetch(url)
    if (!response.ok) throw new Error('Could not fetch deliverable: HTTP ' + response.status)
    contents.push(await response.text())
  }
  const canonical = new TextEncoder().encode(JSON.stringify(contents))
  const digest = await crypto.subtle.digest('SHA-256', canonical)
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('')
}

export function isTimeoutEligible(task, nowMs = Date.now()) {
  return task?.status === 'submitted' && Number(task.resolution_deadline || 0) * 1000 <= nowMs
}

// list_roots returns newest-first, so the first entry is reliably the
// just-created task as long as nobody else posted in the same instant.
// This is deliberately preferred over trusting the write receipt's return
// value field, whose exact shape isn't confirmed anywhere, this is
// something written in this project and its shape is fully known.
export async function latestRootId() {
  try {
    const raw = await readContract('list_roots', [])
    const ids = raw ? JSON.parse(raw) : []
    return Array.isArray(ids) && ids.length ? ids[0] : null
  } catch (e) {
    return null
  }
}

export function fmt(wei) {
  return (Number(wei) / 1e18).toFixed(6)
}

export function short(addr) {
  if (!addr) return ''
  return addr.slice(0, 6) + '…' + addr.slice(-4)
}
