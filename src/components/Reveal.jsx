import React, { useEffect, useRef, useState } from 'react'

// One IntersectionObserver-driven fade-and-rise, applied to every section
// on the page. Fires once, stays visible, never re-hides on scroll back
// up, that would be busy rather than confident.
export default function Reveal({ children, delay = 0, className = '' }) {
  const ref = useRef(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setVisible(true); obs.disconnect() } },
      { threshold: 0.12, rootMargin: '0px 0px -8% 0px' }
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  return (
    <div
      ref={ref}
      className={'reveal' + (visible ? ' in' : '') + (className ? ' ' + className : '')}
      style={{ transitionDelay: delay + 'ms' }}
    >
      {children}
    </div>
  )
}
