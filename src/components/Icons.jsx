import React from 'react'
const base = { viewBox: '0 0 24 24', width: '100%', height: '100%' }

export function IconGrade(props) {
  return (
    <svg {...base} {...props}>
      <rect x="4" y="14" width="3.4" height="6" rx="0.8" />
      <rect x="10.3" y="9" width="3.4" height="11" rx="0.8" />
      <rect x="16.6" y="4" width="3.4" height="16" rx="0.8" />
    </svg>
  )
}
export function IconBranch(props) {
  return (
    <svg {...base} {...props}>
      <circle cx="6" cy="6" r="2.1" />
      <circle cx="6" cy="18" r="2.1" />
      <circle cx="18" cy="12" r="2.1" />
      <path d="M6 8.1v7.8" />
      <path d="M8 6.8 16 10.8" />
      <path d="M8 17.2 16 13.2" />
    </svg>
  )
}
export function IconExit(props) {
  return (
    <svg {...base} {...props}>
      <rect x="4.5" y="10.5" width="12" height="9" rx="1.4" />
      <path d="M8 10.5V7a4 4 0 0 1 7.4-2" />
      <path d="M17 15h4" />
      <path d="M19.3 12.7 21.6 15 19.3 17.3" />
    </svg>
  )
}
export function IconEscrow(props) {
  return (
    <svg {...base} {...props}>
      <path d="M4 8.5 12 4l8 4.5v8L12 21l-8-4.5Z" />
      <path d="M4 8.5 12 13l8-4.5" />
      <path d="M12 13v8" />
    </svg>
  )
}
export function IconJury(props) {
  return (
    <svg {...base} {...props}>
      <circle cx="8" cy="8" r="3" />
      <circle cx="16" cy="8" r="3" />
      <path d="M3.5 20c0-3 2-5 4.5-5s4.5 2 4.5 5" />
      <path d="M11.5 20c0-3 2-5 4.5-5s4.5 2 4.5 5" />
    </svg>
  )
}
export function IconChevron(props) {
  return (
    <svg {...base} {...props}>
      <path d="M9 6l6 6-6 6" />
    </svg>
  )
}
export function IconCopy(props) {
  return (
    <svg {...base} {...props}>
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
    </svg>
  )
}
export function IconMark(props) {
  return (
    <svg {...base} {...props}>
      <path d="M12 3v4" />
      <circle cx="12" cy="8.4" r="1.5" />
      <path d="M12 9.9 7.5 15" />
      <path d="M12 9.9 16.5 15" />
      <circle cx="7.5" cy="16.4" r="1.5" />
      <circle cx="16.5" cy="16.4" r="1.5" />
    </svg>
  )
}
