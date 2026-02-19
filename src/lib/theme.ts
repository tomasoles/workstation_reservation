export async function applyThemeFromLogo(logoUrl = '/logo.svg') {
  try {
    const res = await fetch(logoUrl)
    const svg = await res.text()

    // Extract hex colors; choose the first one as primary.
    const matches = svg.match(/#[0-9a-fA-F]{6}/g) || []
    const primary = matches[0]
    if (primary) {
      document.documentElement.style.setProperty('--blue', primary)
      document.documentElement.style.setProperty('--focus', hexToRgba(primary, 0.35))
      const rgb = hexToRgb(primary)
      if (rgb) document.documentElement.style.setProperty('--blue-rgb', `${rgb.r}, ${rgb.g}, ${rgb.b}`)
    }
  } catch {
    // ignore
  }
}

function hexToRgba(hex: string, alpha: number) {
  const h = hex.replace('#', '')
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const h = hex.replace('#', '')
  if (h.length !== 6) return null
  const r = parseInt(h.slice(0, 2), 16)
  const g = parseInt(h.slice(2, 4), 16)
  const b = parseInt(h.slice(4, 6), 16)
  if ([r, g, b].some((v) => Number.isNaN(v))) return null
  return { r, g, b }
}
