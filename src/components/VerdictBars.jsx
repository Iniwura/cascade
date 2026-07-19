import React, { useEffect, useRef, useState } from 'react'
import { BANDS } from '../lib/tree.js'

// The hero graphic. Not a diagram of the mechanism, the mechanism itself:
// five real verdict bands at their real widths. This is the one sentence
// that explains the whole product, "graded, not gated", rendered instead
// of said. Bars grow in on mount, staggered, once, the moment this
// scrolls into view.
const ORDER = [95, 80, 55, 25, 5]

export default function VerdictBars() {
  const ref = useRef(null)
  const [on, setOn] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setOn(true); obs.disconnect() } }, { threshold: 0.3 })
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  return (
    <div className="vbars" ref={ref}>
      {ORDER.map((score, i) => (
        <div className={'vbar-row' + (on ? ' in' : '')} key={score} style={{ transitionDelay: (i * 90) + 'ms' }}>
          <div className="vbar-label">{BANDS[score]}</div>
          <div className="vbar-track">
            <div className="vbar-fill" style={{ width: on ? score + '%' : '0%', transitionDelay: (i * 90 + 80) + 'ms' }} />
          </div>
          <div className="vbar-pct">{score}%</div>
        </div>
      ))}
    </div>
  )
}
