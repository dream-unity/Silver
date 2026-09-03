export function uid(prefix = 't'): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-3)}`
}

export function nowIso(): string {
  return new Date().toISOString()
}
