import type { Disc, ThrowSettings } from './flight'

const DISCS_KEY = 'disc-reader.discs'
const SETTINGS_KEY = 'disc-reader.settings'

const DEFAULT_SETTINGS: ThrowSettings = { hand: 'right', throw: 'backhand', power: 50 }
/** Earlier versions stored arm speed as a word. */
const LEGACY_POWER: Record<string, number> = { slow: 25, medium: 50, fast: 75 }

function isDisc(v: Partial<Disc>): v is Disc {
  return typeof v.id === 'string' && typeof v.name === 'string' && [v.speed, v.glide, v.turn, v.fade].every((n) => typeof n === 'number')
}

export function loadDiscs(): Disc[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(DISCS_KEY) ?? '[]') as Partial<Disc>[]
    return Array.isArray(parsed) ? parsed.filter(isDisc) : []
  } catch {
    return []
  }
}

export function saveDiscs(discs: Disc[]): void {
  localStorage.setItem(DISCS_KEY, JSON.stringify(discs))
}

export function loadSettings(): ThrowSettings {
  try {
    const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') as Partial<Omit<ThrowSettings, 'power'>> & { power?: number | string }
    const power = typeof stored.power === 'number' ? stored.power : LEGACY_POWER[stored.power ?? ''] ?? DEFAULT_SETTINGS.power
    return { ...DEFAULT_SETTINGS, ...stored, power }
  } catch {
    return DEFAULT_SETTINGS
  }
}

export function saveSettings(settings: ThrowSettings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
}
