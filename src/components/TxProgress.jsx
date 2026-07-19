import React from 'react'

// Real GenLayer consensus states, confirmed against the SDK's own
// TransactionStatus enum, not invented labels. PENDING through REVEALING
// happen fast for simple writes and can be genuinely instant for a
// deterministic call; they slow down and become visible for anything
// that hits the AI jury, which is exactly when someone watching this
// modal most wants to know something is still happening.
const STEPS = [
  { key: 'PENDING',    label: 'Sent to the network' },
  { key: 'PROPOSING',  label: 'Leader proposing a result' },
  { key: 'COMMITTING', label: 'Validators committing votes' },
  { key: 'REVEALING',  label: 'Validators revealing votes' },
  { key: 'ACCEPTED',   label: 'Accepted' },
]

export default function TxProgress({ phase, error, onRetry, onDismiss }) {
  if (!phase) return null
  const stepIndex = STEPS.findIndex(s => s.key === phase)
  const failed = phase === 'failed'
  const done = phase === 'done' || phase === 'ACCEPTED'

  return (
    <div className="txp-overlay" onClick={done || failed ? onDismiss : undefined}>
      <div className="txp-card" onClick={e => e.stopPropagation()}>
        {!failed && !done && (
          <>
            <div className="txp-bar-track"><div className="txp-bar-fill" /></div>
            <div className="txp-steps">
              {STEPS.map((s, i) => {
                const state = stepIndex === -1 ? (i === 0 ? 'active' : 'pending')
                  : i < stepIndex ? 'done' : i === stepIndex ? 'active' : 'pending'
                return (
                  <div key={s.key} className={'txp-step ' + state}>
                    <span className="txp-dot">{state === 'done' ? '\u2713' : i + 1}</span>
                    <span>{s.label}</span>
                  </div>
                )
              })}
            </div>
            <p className="txp-note">This can take a moment on testnet. Leave this open.</p>
          </>
        )}

        {done && (
          <div className="txp-result">
            <span className="txp-dot done big">{'\u2713'}</span>
            <p>Confirmed.</p>
            <button className="btn btn-primary" onClick={onDismiss}>Done</button>
          </div>
        )}

        {failed && (
          <div className="txp-result">
            <span className="txp-dot fail big">!</span>
            <p>{error || 'Something went wrong.'}</p>
            <div className="hero-cta" style={{ justifyContent: 'center', marginTop: 4 }}>
              {onRetry && <button className="btn btn-primary" onClick={onRetry}>Retry</button>}
              <button className="btn btn-secondary" onClick={onDismiss}>Dismiss</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
