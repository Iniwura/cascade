// One shared list, so the same word never gets typed three slightly
// different ways across the posting form, the skills picker, and the
// board filters, which is exactly what free-text tagging breaks into.
export const SKILL_TAGS = [
  'smart-contracts', 'frontend', 'backend', 'design',
  'writing', 'data', 'security', 'devops',
]
