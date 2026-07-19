import React, { useEffect, useState, useCallback, useRef } from 'react'
import Panel from './components/Panel.jsx'
import CascadeTree from './components/Cascade.jsx'
import VerdictBars from './components/VerdictBars.jsx'
import Dashboard from './components/Dashboard.jsx'
import JobBoard from './components/JobBoard.jsx'
import NotificationBell from './components/NotificationBell.jsx'
import TagPicker from './components/TagPicker.jsx'
import Onboarding from './components/Onboarding.jsx'
import { useNotifications } from './hooks/useNotifications.js'
import Reveal from './components/Reveal.jsx'
import TxProgress from './components/TxProgress.jsx'
import { IconGrade, IconBranch, IconExit, IconEscrow, IconJury, IconChevron, IconMark, IconCopy } from './components/Icons.jsx'
import { parseTree, ledger, rootIdOf } from './lib/tree.js'
import { getKnownJobs, addKnownJob } from './lib/jobIndex.js'
import {
  readContract, writeContract, pollForChange, latestRootId,
  genToWeiString, fmt, short, isAddress, resolveAgentInput,
  CONTRACT, DEMO_ROOT, CHAIN_ID, NET, EXPLORER,
} from './lib/gl.js'

const URL_HINT = 'https://raw.githubusercontent.com/user/repo/main/file.js'

// Turns whatever a failed transaction threw into one clean sentence.
// MetaMask shows its own raw error dialog when a transaction genuinely
// reverts, that's the wallet's UI and cannot be suppressed from here.
// What this controls is what CASCADE shows afterward, and a multi
// thousand character GenVM log dump never belongs in that.
function friendlyError(e) {
  const m = String(e?.message || e || '')
  if (e?.code === 4001 || /user rejected/i.test(m)) return { text: 'Transaction cancelled.', type: 'info' }
  if (/insufficient funds/i.test(m)) return { text: 'Not enough GEN in this wallet for that amount.', type: 'error' }
  if (/retry resolve/i.test(m) || /timeout/i.test(m))
    return { text: 'The jury did not answer in time. Nothing changed on chain, try again.', type: 'error' }
  if (/Could not fetch deliverable/i.test(m))
    return { text: 'The jury could not open that link. Check the URL and try again.', type: 'error' }
  if (/sigterm/i.test(m) || /genvm execution error/i.test(m) || m.length > 300)
    return { text: 'The network had a hiccup executing this transaction. It was not caused by your input, try again in a moment.', type: 'error' }
  return { text: m.slice(0, 160) || 'Something went wrong.', type: 'error' }
}

const TABS = [
  { key: 'home',      label: 'Home' },
  { key: 'job',       label: 'Job' },
  { key: 'dashboard', label: 'Dashboard' },
]

export default function App() {
  const [account, setAccount] = useState('')
  const [genBal, setGenBal] = useState(0)
  const [rootId, setRootId] = useState(DEMO_ROOT)
  const [flat, setFlat] = useState(null)
  const [busy, setBusy] = useState('')
  const [notes, setNotes] = useState([])
  const [form, setForm] = useState(null)
  const [view, setView] = useState('home')
  const [tx, setTx] = useState(null)
  const [copiedAddr, setCopiedAddr] = useState(false)
  const [boardReload, setBoardReload] = useState(0)
  const [showOnboarding, setShowOnboarding] = useState(false)
  const { notes: jobNotes, unread, markAllRead } = useNotifications(account)
  const noteId = useRef(0)

  // Stacked, top-right, auto-dismissing, typed. Replaces the single
  // bottom snackbar so more than one thing can be true at once (e.g. a
  // background poll finishing while someone's mid-form).
  const notify = (text, type = 'info') => {
    const id = ++noteId.current
    setNotes(n => [...n, { id, text, type }])
    setTimeout(() => setNotes(n => n.filter(x => x.id !== id)), 6000)
  }
  const dismiss = (id) => setNotes(n => n.filter(x => x.id !== id))

  // silent=true on the initial mount load: a fresh contract with nothing
  // posted yet is not an error, and greeting every first-time visitor
  // with a failed-read toast before they've done anything is worse than
  // just showing the tree panel's own empty state.
  const load = useCallback(async (id = rootId, silent = false) => {
    try {
      const raw = await readContract('get_tree', [String(id)])
      const parsed = parseTree(raw)
      if (parsed) { setFlat(parsed); return parsed }
      setFlat(null)
      if (!silent) notify('No job found at id ' + id + '.', 'error')
    } catch (e) {
      setFlat(null)
      if (!silent) {
        const { text } = friendlyError(e)
        notify(text, 'error')
      }
    }
    return null
  }, [rootId])

  useEffect(() => { addKnownJob(DEMO_ROOT); load(DEMO_ROOT, true) }, [])

  // Auto-clear a successful transaction card after a beat, failures stay
  // open until the person acts on them.
  useEffect(() => {
    if (tx?.phase === 'done') {
      const t = setTimeout(() => setTx(null), 1100)
      return () => clearTimeout(t)
    }
  }, [tx?.phase])

  const connect = async () => {
    const eth = window.ethereum
    if (!eth) { notify('Install MetaMask to connect a wallet.', 'error'); return }
    try {
      const accs = await eth.request({ method: 'eth_requestAccounts' })
      try {
        await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: CHAIN_ID }] })
      } catch (e) {
        if (e.code === 4902 || e.code === -32603)
          await eth.request({ method: 'wallet_addEthereumChain', params: [NET] })
      }
      const a = accs[0].toLowerCase()
      setAccount(a); window._glAccount = a
      const b = await eth.request({ method: 'eth_getBalance', params: [a, 'latest'] })
      setGenBal(Number(BigInt(b)) / 1e18)
      notify('Wallet connected.', 'success')
      eth.on('accountsChanged', as => { if (!as.length) { setAccount(''); window._glAccount = '' } })
      eth.on('chainChanged', () => window.location.reload())

      let seen = false
      try { seen = localStorage.getItem('cascade:onboarded:' + a) === '1' } catch (e) { /* private mode, treat as unseen */ }
      if (!seen) setShowOnboarding(true)
    } catch (e) { notify(e.message || 'Connection failed.', 'error') }
  }

  const finishOnboarding = async (tags) => {
    if (account) { try { localStorage.setItem('cascade:onboarded:' + account, '1') } catch (e) {} }
    setShowOnboarding(false)
    if (tags) await setMyTags(tags)
  }

  // MetaMask has no API for a site to force a real disconnect, that's
  // deliberate on their end, only the wallet itself can revoke a site's
  // permission. This clears Cascade's own view of the connection, the
  // wallet-connect button reappears, but MetaMask will still remember
  // this site was authorized until revoked from inside the wallet.
  const disconnect = () => {
    setAccount(''); window._glAccount = ''; setGenBal(0); setBoardReload(k => k + 1)
    notify('Disconnected from Cascade. MetaMask may still show this site as connected, revoke it there if you want that gone too.', 'info')
  }

  const readTree = async () => parseTree(await readContract('get_tree', [rootId]))

  const send = async (label, method, args, value = 0n, until) => {
    if (!account) { notify('Connect a wallet first.', 'error'); return }
    setBusy(label)
    setTx({ phase: 'PENDING' })
    try {
      await writeContract(account, method, args, value, phase => setTx({ phase }))
      if (until) await pollForChange(until)
      await load(rootId)
      setTx({ phase: 'done' })
      notify(label.charAt(0).toUpperCase() + label.slice(1) + '.', 'success')
      setBoardReload(k => k + 1)
      setForm(null)
    } catch (e) {
      const { text, type } = friendlyError(e)
      setTx({ phase: 'failed', error: text, retry: () => send(label, method, args, value, until) })
      notify(text, type)
    } finally { setBusy('') }
  }

  const postJob = async (spec, gen, agent, tags) => {
    if (!account) { notify('Connect a wallet first.', 'error'); return }
    if (!spec.trim()) { notify('Write a spec first.', 'error'); return }
    const genNum = parseFloat(gen)
    if (!isFinite(genNum) || genNum <= 0) { notify('Enter a GEN amount greater than zero.', 'error'); return }
    let agentArg = ''
    try { agentArg = await resolveAgentInput(agent) }
    catch (e) { notify(e.message, 'error'); return }
    setBusy('posting job')
    setTx({ phase: 'PENDING' })
    try {
      const wei = BigInt(genToWeiString(gen))
      await writeContract(account, 'create_root_task', [spec, agentArg, (tags || '').trim()], wei, phase => setTx({ phase }))
      // list_roots is newest-first and its shape is fully known, more
      // reliable here than trusting the write receipt's return-value field.
      const newId = await latestRootId()
      if (newId) {
        addKnownJob(newId)
        setRootId(newId)
        await load(newId)
      }
      setTx({ phase: 'done' })
      notify('Job posted.', 'success')
      setBoardReload(k => k + 1)
      setForm(null)
      return newId
    } catch (e) {
      const { text, type } = friendlyError(e)
      setTx({ phase: 'failed', error: text, retry: () => postJob(spec, gen, agent, tags) })
      notify(text, type)
    } finally { setBusy('') }
  }

  const handOff = async (pid, spec, agent, gen, tags) => {
    if (!spec.trim()) { notify('Write a spec for the piece being handed off.', 'error'); return }
    const genNum = parseFloat(gen)
    if (!isFinite(genNum) || genNum <= 0) { notify('Enter an amount greater than zero.', 'error'); return }
    let agentArg = ''
    try { agentArg = await resolveAgentInput(agent) }
    catch (e) { notify(e.message, 'error'); return }
    return send('piece handed off', 'subcontract',
      [pid, spec, agentArg, genToWeiString(gen), (tags || '').trim()], 0n,
      async () => { const t = await readTree(); return t && (t[pid]?.children || []).length > (flat?.[pid]?.children || []).length })
  }

  const submitWork = (id, urls) =>
    send('work submitted', 'submit_deliverable', [id, urls.trim()], 0n,
      async () => { const t = await readTree(); return t && t[id]?.status === 'submitted' })

  const askJury = (id) =>
    send('jury asked', 'resolve_task', [id], 0n,
      async () => { const t = await readTree(); return t && t[id]?.status === 'resolved' })

  const pull = (id) =>
    send('submission pulled', 'withdraw_deliverable', [id], 0n,
      async () => { const t = await readTree(); return t && t[id]?.status === 'posted' })

  const takeBack = (id) =>
    send('taken back', 'reclaim_task', [id], 0n,
      async () => { const t = await readTree(); return t && t[id]?.status === 'reclaimed' })

  const claimTask = (id) =>
    send('job claimed', 'claim_task', [id], 0n,
      async () => { const t = await readTree(); return t && t[id]?.agent === account })

  const setMyTags = (tags) =>
    send('skills updated', 'set_agent_tags', [tags.trim()], 0n, null)

  const setMyUsername = (name) =>
    send('username set', 'set_username', [name.trim()], 0n, null)

  const actions = (id, t) => {
    if (!account || !flat) return null
    const isAgent = account === t.agent
    const isBuyer = account === t.buyer
    const isOpen = t.agent === ''
    const kidsDone = (t.children || []).every(c => ['resolved', 'reclaimed'].includes(flat[c]?.status))
    // reclaim_task requires every child to specifically be 'reclaimed',
    // not 'resolved' too, that's a different, stricter bar than the one
    // resolve_task checks. Reusing kidsDone here would show the button
    // when the contract would actually still reject it.
    const kidsReclaimed = (t.children || []).every(c => flat[c]?.status === 'reclaimed')
    const A = []
    if (isOpen && t.status === 'posted') A.push(['Claim this job', () => claimTask(id), true])
    if (isAgent && t.status === 'posted') {
      A.push(['Hand off a piece', () => setForm({ kind: 'hand', id }), false])
      A.push(['Submit work', () => setForm({ kind: 'submit', id }), false])
    }
    if (isAgent && t.status === 'submitted') A.push(['Pull submission', () => pull(id), false])
    if (isBuyer && t.status === 'submitted' && kidsDone) A.push(['Ask the jury', () => askJury(id), true])
    if (isBuyer && t.status === 'posted' && kidsReclaimed) A.push(['Take it back', () => takeBack(id), false])

    // Resolve is buyer-only now. Without this, an agent who's submitted
    // and is just waiting sees an empty action row with no explanation,
    // which reads as broken rather than "the buyer has to act now."
    const waiting = isAgent && !isBuyer && t.status === 'submitted' && kidsDone
    // Buyer wants to reclaim but a child hasn't been reclaimed yet, tell
    // them why the button isn't there instead of leaving it silent.
    const blockedReclaim = isBuyer && t.status === 'posted' && !kidsReclaimed && (t.children || []).length > 0

    if (!A.length && !waiting && !blockedReclaim) return null
    return (
      <>
        {blockedReclaim && <p className="waiting-note">A subcontracted piece must be taken back first before this one can be.</p>}
        {A.map(([label, fn, primary]) => (
          <button key={label} className={'btn-sm' + (primary ? ' primary' : '')} onClick={fn} disabled={!!busy}>{label}</button>
        ))}
        {waiting && <p className="waiting-note">Submitted. Waiting for the buyer to ask the jury.</p>}
      </>
    )
  }

  const L = flat ? ledger(flat) : null
  const goPost = () => { setView('job'); setForm({ kind: 'post' }); window.scrollTo({ top: 0, behavior: 'smooth' }) }
  const goJob = () => { setView('job'); window.scrollTo({ top: 0, behavior: 'smooth' }) }
  const openFromDashboard = (id) => {
    setRootId(id); load(id); setView('job')
    setTimeout(() => document.getElementById('job-detail')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 30)
  }
  const copyContract = async () => {
    try { await navigator.clipboard.writeText(CONTRACT); setCopiedAddr(true); setTimeout(() => setCopiedAddr(false), 1300) } catch (e) {}
  }

  return (
    <>
      <nav className="nav">
        <div className="container nav-in">
          <button className="brand" onClick={() => setView('home')} style={{ background: 'none', border: 'none' }}>
            <div className="brand-mark"><IconMark /></div>
            <span className="brand-name">Cascade</span>
            <span className="brand-net">Bradbury</span>
          </button>
          <div className="nav-links">
            {TABS.map(t => (
              <button key={t.key} className={'nav-link' + (view === t.key ? ' on' : '')} onClick={() => setView(t.key)}>{t.label}</button>
            ))}
          </div>
          <div className="nav-right">
            {account && (
              <NotificationBell
                notes={jobNotes}
                unread={unread}
                onMarkRead={markAllRead}
                onOpenNote={(jobId) => { setRootId(jobId); load(jobId); goJob() }}
              />
            )}
            {account
              ? <button className="wallet-btn on" onClick={disconnect} title="Click to disconnect">{short(account)} · {genBal.toFixed(3)} GEN</button>
              : <button className="wallet-btn" onClick={connect}>Connect wallet</button>}
          </div>
        </div>
      </nav>

      {view === 'dashboard' && (
        <Dashboard
          account={account}
          onOpen={openFromDashboard}
          onSaveTags={setMyTags}
          savingTags={busy === 'skills updated' ? 'Saving' : ''}
          onSaveUsername={setMyUsername}
          savingUsername={busy === 'username set' ? 'Saving' : ''}
        />
      )}

      {view === 'home' && <>
      <section className="hero container">
        <div className="hero-grid">
          <div className="hero-enter">
            <div className="kicker"><span className="dot" />Live on GenLayer Bradbury</div>
            <h1>Work is paid by the piece.</h1>
            <p className="hero-sub">
              An AI jury reads what an agent delivered, grades it against the spec both
              sides agreed to, and releases exactly that share of the escrow. Hand a piece
              of the job to another agent and the same thing happens one level down.
              <strong> Nobody is paid for work they did not do. Nothing gets stuck.</strong>
            </p>
            <div className="hero-cta">
              <button className="btn btn-primary" onClick={goPost} disabled={!!busy}>Post a job</button>
              <button className="btn btn-secondary" onClick={goJob}>View the live job <IconChevron style={{ width: 14, height: 14 }} /></button>
            </div>
          </div>
          <div className="hero-art hero-enter d1">
            <div className="hero-art-label">graduated by verdict, not pass or fail</div>
            <VerdictBars />
          </div>
        </div>

        <div className="stats hero-enter d2">
          <div className="stat">
            <div className="stat-num">5<span className="u">bands</span></div>
            <div className="stat-lbl">Graded verdicts, never pass or fail</div>
          </div>
          <div className="stat">
            <div className="stat-num">0<span className="u">stuck</span></div>
            <div className="stat-lbl">Wei ever unreachable by design</div>
          </div>
          <div className="stat">
            <div className="stat-num">1<span className="u">call</span></div>
            <div className="stat-lbl">Loads a whole subcontracting tree</div>
          </div>
        </div>
      </section>

      <Reveal>
      <section className="section container">
        <div className="section-head">
          <div className="section-kicker">why it's different</div>
          <h2 className="section-h">Escrow that grades, not just gates.</h2>
        </div>
        <div className="values">
          <div className="value">
            <div className="value-icon"><IconGrade /></div>
            <h3>Graded, not gated</h3>
            <p>The jury picks one of five verdicts and releases that share. An agent who delivered most of the spec is paid for most of the spec.</p>
          </div>
          <div className="value">
            <div className="value-icon"><IconBranch /></div>
            <h3>Work runs downhill</h3>
            <p>An agent can hand off part of a job, paid out of their own share. Every level is graded on its own deliverable before its parent can settle.</p>
          </div>
          <div className="value">
            <div className="value-icon"><IconExit /></div>
            <h3>Nothing gets stuck</h3>
            <p>A jury that doesn't answer costs a retry, not your money. Either side can walk away without the other's consent.</p>
          </div>
        </div>
      </section>
      </Reveal>

      <Reveal>
      <section className="section container" id="how">
        <div className="section-head">
          <div className="section-kicker">how it works</div>
          <h2 className="section-h">Four steps, each one on chain.</h2>
        </div>
        <div className="steps">
          <div className="step">
            <div className="step-num">01</div>
            <div className="step-body">
              <h3><IconEscrow style={{ width: 16, height: 16, display: 'inline', verticalAlign: -2, marginRight: 6 }} />Escrow the job<span className="step-tag">create_root_task</span></h3>
              <p>The buyer writes the spec in plain language and locks the GEN. That spec is what the jury grades against later, so it is the contract, not a description of one.</p>
            </div>
          </div>
          <div className="step">
            <div className="step-num">02</div>
            <div className="step-body">
              <h3><IconBranch style={{ width: 16, height: 16, display: 'inline', verticalAlign: -2, marginRight: 6 }} />Carve out a piece<span className="step-tag">subcontract</span></h3>
              <p>The agent can hand part of the job to someone else, out of their own allocation. The contract won't let them promise more than they hold, so the tree can't go insolvent.</p>
            </div>
          </div>
          <div className="step">
            <div className="step-num">03</div>
            <div className="step-body">
              <h3><IconJury style={{ width: 16, height: 16, display: 'inline', verticalAlign: -2, marginRight: 6 }} />Ask the jury<span className="step-tag">resolve_task</span></h3>
              <p>Independent AI models read the deliverable and settle on FULL, MINOR_GAPS, PARTIAL, TANGENTIAL, or UNRELATED, releasing 95, 80, 55, 25, or 5 percent.</p>
            </div>
          </div>
          <div className="step">
            <div className="step-num">04</div>
            <div className="step-body">
              <h3><IconExit style={{ width: 16, height: 16, display: 'inline', verticalAlign: -2, marginRight: 6 }} />Always a way out<span className="step-tag">withdraw / reclaim</span></h3>
              <p>No timeout, because no clock here is worth trusting. The agent can pull their submission any time; the buyer can reclaim only once nothing is submitted.</p>
            </div>
          </div>
        </div>
      </section>
      </Reveal>

      <Reveal>
      <section className="section container" id="contract">
        <div className="section-head">
          <div className="section-kicker">the contract</div>
          <h2 className="section-h">One address, on a real testnet.</h2>
          <p className="section-p">No mocks. Everything in this app reads and writes the same deployed contract.</p>
        </div>
        <div className="contract-card">
          <div className="contract-row">
            <span className="contract-lbl">Address</span>
            <span className="mono contract-val">{CONTRACT}</span>
            <button className="btn-sm" onClick={copyContract} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <span style={{ width: 12, height: 12, display: 'inline-block' }}><IconCopy /></span>
              {copiedAddr ? 'Copied' : 'Copy'}
            </button>
          </div>
          <div className="contract-row">
            <span className="contract-lbl">Network</span>
            <span className="contract-val">GenLayer Bradbury testnet</span>
          </div>
          <div className="contract-row">
            <span className="contract-lbl">Explorer</span>
            <a className="contract-val link" href={EXPLORER} target="_blank" rel="noreferrer">View on explorer <IconChevron style={{ width: 12, height: 12, display: 'inline', verticalAlign: -1 }} /></a>
          </div>
        </div>
      </section>
      </Reveal>

      <Reveal>
      <div className="cta-final">
        <div className="container" style={{ padding: 0 }}>
          <h2>Post work. Grade it fairly.<br />Pay exactly what it earned.</h2>
          <p>Escrow a job, subcontract it as deep as you need, and let independent AI models settle who earned what.</p>
          <div className="row">
            <button className="btn btn-primary" onClick={goPost} disabled={!!busy}>Post a job</button>
            <a className="btn btn-secondary" href={EXPLORER} target="_blank" rel="noreferrer">Read the contract</a>
          </div>
        </div>
      </div>
      </Reveal>
      </>}

      {view === 'job' && <>
      <section className="section container">
        <div className="section-head">
          <div className="section-kicker">the board</div>
          <h2 className="section-h">Every job, wherever it is.</h2>
          <p className="section-p">Open jobs anyone can claim, work already in progress, and everything settled.</p>
        </div>

        <div className="hero-cta" style={{ marginBottom: 32 }}>
          <button className="btn btn-primary" onClick={() => setForm({ kind: 'post' })} disabled={!!busy}>Post a job</button>
        </div>

        <JobBoard reloadKey={boardReload} onOpen={(id) => {
          setRootId(id); load(id)
          setTimeout(() => document.getElementById('job-detail')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 30)
        }} />

        {form && (
          <div className="panel" style={{ marginTop: 24 }}>
            <div className="panel-body form-panel">
              <InlineForm form={form} flat={flat} busy={busy} onCancel={() => setForm(null)} onPost={postJob} onHand={handOff} onSubmit={submitWork} />
            </div>
          </div>
        )}
      </section>

      <div className="rule container" />

      <section className="section container" id="job-detail">
        <div className="section-head">
          <div className="section-kicker">not a mockup</div>
          <h2 className="section-h">This panel reads the contract.</h2>
          <p className="section-p">
            It calls <span className="mono">get_tree</span> on Bradbury and prints exactly what
            comes back, a real escrow, graded by a real jury, resolved on chain.
          </p>
        </div>

        <Panel
          title={'get_tree(' + rootId + ')'}
          live
          raw={flat ? JSON.stringify(flat, null, 2) : ''}
          foot={L && (
            <div className="ledger-row">
              <span>in <b className="mono">{fmt(L.escrowed)}</b></span>
              <span className="earned">earned <b className="mono">{fmt(L.earned)}</b></span>
              {L.returned > 0 && <span className="returned">returned <b className="mono">{fmt(L.returned)}</b></span>}
              {L.pooled > 0 && <span className="returned">pooled <b className="mono">{fmt(L.pooled)}</b></span>}
              {L.rootResolved && <span className="balanced">{L.balanced ? '\u2713 balanced' : 'mismatch'}</span>}
            </div>
          )}
        >
          <CascadeTree flat={flat} actions={actions} />
        </Panel>

        {L && L.rootResolved && (
          <div className="ledger-big" style={{ padding: '56px 0 8px' }}>
            <div className="section-kicker" style={{ textAlign: 'center' }}>the whole claim, in one line</div>
            <div className="num">
              <span className="mono">{fmt(L.escrowed)}</span> GEN in.{' '}
              <span className="earned mono">{fmt(L.earned)}</span> earned.{' '}
              <span className="returned mono">{fmt(L.returned)}</span> returned.
            </div>
            <div className="ledger-big-sub">
              {L.balanced ? 'Nothing lost, nothing stuck.' : 'Ledger mismatch, investigate.'}{' '}
              Verified on the <a href={EXPLORER} target="_blank" rel="noreferrer">Bradbury explorer</a>.
            </div>
          </div>
        )}
      </section>
      </>}

      <footer className="foot container">
        <div className="foot-top">
          <div style={{ maxWidth: 320 }}>
            <div className="foot-brand"><IconMark style={{ width: 16, height: 16, display: 'inline-block' }} />Cascade</div>
            <p>Graduated payout for subcontracted work, settled by an AI jury on GenLayer.</p>
          </div>
          <div className="foot-links">
            <div className="foot-links-col">
              <div>Contract</div>
              <a href={EXPLORER} target="_blank" rel="noreferrer">{short(CONTRACT)}</a>
              <span>GenLayer Bradbury</span>
            </div>
            <div className="foot-links-col">
              <div>Product</div>
              <button className="link-btn" onClick={() => setView('home')}>Home</button>
              <button className="link-btn" onClick={() => setView('job')}>Job</button>
              <button className="link-btn" onClick={() => setView('dashboard')}>Dashboard</button>
            </div>
          </div>
        </div>
        <div className="foot-fine">{`The jury reads the first 4,000 characters of whatever you link. Focused artifacts grade reliably: a component, a module, a diff. A thousand-line file gets sampled.

Grading is judgment, not arithmetic. Two juries can land a band apart on the same work. That is why it is a band and not a number.`}</div>
      </footer>

      {showOnboarding && (
        <Onboarding onFinish={finishOnboarding} saving={busy === 'skills updated' ? 'Saving' : ''} />
      )}

      <TxProgress
        phase={tx?.phase}
        error={tx?.error}
        onRetry={tx?.retry ? () => { setTx(null); tx.retry() } : null}
        onDismiss={() => setTx(null)}
      />

      {notes.length > 0 && (
        <div className="notif-stack">
          {notes.map(n => (
            <div key={n.id} className={'notif ' + n.type} onClick={() => dismiss(n.id)}>
              {n.text}
            </div>
          ))}
        </div>
      )}
    </>
  )
}

function InlineForm({ form, flat, onCancel, onPost, onHand, onSubmit, busy }) {
  const [a, setA] = useState('')
  const [b, setB] = useState('')
  const [c, setC] = useState('')
  const [d, setD] = useState('')
  const [urls, setUrls] = useState([''])

  const t = form.id ? flat?.[form.id] : null
  const ceiling = t ? fmt(t.self_allocated) : '0'

  const setUrlAt = (i, v) => setUrls(u => u.map((x, j) => (j === i ? v : x)))
  const addUrl = () => setUrls(u => (u.length < 3 ? [...u, ''] : u))
  const removeUrl = (i) => setUrls(u => u.filter((_, j) => j !== i))

  const go = () => {
    if (form.kind === 'post') onPost(a, c, b, d)
    if (form.kind === 'hand') onHand(form.id, a, b, c, d)
    if (form.kind === 'submit') onSubmit(form.id, urls.map(u => u.trim()).filter(Boolean).join(','))
  }
  const key = e => { if (e.key === 'Enter') go() }

  const title = form.kind === 'post' ? 'Post a job'
    : form.kind === 'hand' ? 'Hand off a piece of #' + form.id
    : 'Submit work for #' + form.id

  return (
    <>
      <div className="form-title">{title}</div>
      {form.kind === 'submit' ? (
        <div className="form-row">
          <label>Deliverable URL(s)</label>
          {urls.map((u, i) => (
            <div key={i} className="url-row">
              <input
                autoFocus={i === 0}
                value={u}
                onChange={e => setUrlAt(i, e.target.value)}
                onKeyDown={key}
                placeholder={URL_HINT}
              />
              {urls.length > 1 && (
                <button type="button" className="url-remove" onClick={() => removeUrl(i)} aria-label="Remove">×</button>
              )}
            </div>
          ))}
          {urls.length < 3 && (
            <button type="button" className="btn-sm" onClick={addUrl} style={{ marginTop: 8, alignSelf: 'flex-start' }}>
              + Add another {urls.length > 0 ? '(' + urls.length + '/3)' : ''}
            </button>
          )}
        </div>
      ) : (
        <>
          <div className="form-row">
            <label>Spec</label>
            <input autoFocus value={a} onChange={e => setA(e.target.value)} onKeyDown={key} placeholder="What the work has to do, in plain language" />
          </div>
          <div className="form-row">
            <label>Agent</label>
            <input value={b} onChange={e => setB(e.target.value)} onKeyDown={key} placeholder="0x... or a username (leave blank to let anyone claim it)" />
          </div>
          <div className="form-row">
            <label>Amount (GEN)</label>
            <input
              value={c}
              onChange={e => setC(e.target.value)}
              onKeyDown={key}
              placeholder={form.kind === 'hand' ? 'Up to ' + ceiling + ' available' : 'GEN to escrow'}
            />
          </div>
          <TagPicker value={d} onChange={setD} label="Skill tags (optional)" />
        </>
      )}
      <div className="form-acts">
        <button className="btn btn-primary" onClick={go} disabled={!!busy}>{busy || 'Send'}</button>
        <button className="btn btn-secondary" onClick={onCancel}>Cancel</button>
      </div>
    </>
  )
}
