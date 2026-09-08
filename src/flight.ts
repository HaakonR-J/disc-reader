export interface FlightNumbers {
  speed: number
  glide: number
  turn: number
  fade: number
}

export interface Disc extends FlightNumbers {
  id: string
  name: string
  compare: boolean
  /** Small JPEG data URL, optional. */
  image?: string
}

export type Hand = 'right' | 'left'
export type Throw = 'backhand' | 'forehand'

export interface ThrowSettings {
  hand: Hand
  throw: Throw
  /** Arm speed 0-100, mapped to release speed by `releaseSpeedMph`. */
  power: number
}

/** Point along the flight in metres: x to the right of the thrower, y downfield. */
export interface Point {
  x: number
  y: number
}

const FEET_PER_METRE = 3.281

/*
 * Model notes (sources in the README of this conversation):
 * - Distance grows about 7.2 ft per mph of release speed between 45 and 70 mph (Pozzy 2000), and a
 *   distance driver released at 56 mph lands near 300 ft. We use 8 ft/mph around that anchor.
 * - A disc's speed rating says how fast it must be thrown to fly like its numbers. No official table
 *   exists; the community rule "max distance / 30-35 ft = usable speed" and quoted fairway-driver
 *   speeds of 44-54 mph give roughly 30 + 3 × speed mph.
 * - Turn and fade are gyroscopic precession: their rate is inversely proportional to spin. Thrown
 *   slower than rated, a disc turns less and fades earlier; thrown faster, it turns more.
 * - Forehands carry clearly less spin than backhands at the same speed (TechDisc advance-ratio targets
 *   of 30% vs 50%), so they turn and fade more and go a little shorter.
 */

/** Slider 0-100 → release speed: 35 mph (a first-timer) to 80 mph (top pro). 50 is about 57 mph. */
export function releaseSpeedMph(power: number): number {
  const p = Math.min(100, Math.max(0, power))
  return 35 + (p / 100) * 45
}

/** Release speed a disc is rated for, from its speed number. */
export function ratedSpeedMph(speed: number): number {
  return 30 + 3 * speed
}

/** Distance in metres a well-matched disc flies at this release speed. */
export function matchedDistance(mph: number): number {
  const feet = Math.max(90, 300 + 8 * (mph - 56))
  return feet / FEET_PER_METRE
}

export function powerLabel(power: number): string {
  if (power < 20) return 'Nybegynner'
  if (power < 40) return 'Svak arm'
  if (power < 60) return 'Middels arm'
  if (power < 80) return 'Sterk arm'
  return 'Proff-arm'
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v))
}

/** Degrees of heading change per unit of effective turn / fade over the whole flight. */
const TURN_DEGREES = 10
const FADE_DEGREES = 14

/** Fraction of release speed left at landing. */
const LANDING_SPEED = 0.35

/** Weight of turn along the flight (only while the disc is fast), normalised so it integrates to 1. */
function turnWeight(s: number): number {
  const u = 1 - (1 - LANDING_SPEED) * s
  return clamp01((u - 0.6) / 0.4) ** 1.5
}

/** Weight of fade along the flight (only once the disc has slowed), normalised so it integrates to 1. */
function fadeWeight(s: number): number {
  const u = 1 - (1 - LANDING_SPEED) * s
  return clamp01((0.72 - u) / 0.37) ** 2
}

function integral(fn: (s: number) => number, steps = 200): number {
  let sum = 0
  for (let i = 0; i < steps; i++) sum += fn((i + 0.5) / steps) / steps
  return sum
}

const TURN_NORM = integral(turnWeight)
const FADE_NORM = integral(fadeWeight)

export interface FlightSummary {
  /** Release speed in mph. */
  mph: number
  /** How the throw compares with the disc's rated speed: 1 is a perfect match. */
  ratio: number
  effectiveTurn: number
  effectiveFade: number
  /** Metres downfield at landing. */
  distance: number
  /** Metres sideways at landing, positive to the right. */
  drift: number
  points: Point[]
}

export function simulate(d: FlightNumbers, s: ThrowSettings, steps = 80): FlightSummary {
  const mph = releaseSpeedMph(s.power)
  const ratio = mph / ratedSpeedMph(d.speed)
  const forehand = s.throw === 'forehand'
  // Less spin on forehands: turn and fade rates go up, distance down a little.
  const spinFactor = forehand ? 1.35 : 1
  const throwFactor = forehand ? 0.92 : 1

  // Under-powered discs lose distance quickly; over-powered ones flip and lose some too.
  const efficiency = ratio < 1 ? 0.45 + 0.55 * ratio : Math.max(0.6, 1 - 0.25 * (ratio - 1))
  const glideFactor = 0.88 + 0.03 * d.glide
  // Beyond about -4.5 the disc rolls over rather than turning further; beyond fade 6 it just dives.
  const effectiveTurn = Math.max(-4.5, d.turn * ratio ** 1.5 * spinFactor)
  const effectiveFade = Math.min(6, d.fade * ratio ** -1.2 * spinFactor)
  const turnoverLoss = 1 - 0.06 * Math.max(0, -effectiveTurn - 3)
  const length = matchedDistance(mph) * efficiency * glideFactor * throwFactor * turnoverLoss

  // Right-hand backhand: negative turn drifts right, fade finishes left. Forehand or left hand mirrors.
  const mirror = (s.hand === 'right') === forehand ? -1 : 1
  const points: Point[] = [{ x: 0, y: 0 }]
  let heading = 0 // radians, positive = right
  let x = 0
  let y = 0
  const ds = length / steps
  for (let i = 0; i < steps; i++) {
    const sMid = (i + 0.5) / steps
    const turnRate = (-effectiveTurn * TURN_DEGREES * turnWeight(sMid)) / TURN_NORM
    const fadeRate = (-effectiveFade * FADE_DEGREES * fadeWeight(sMid)) / FADE_NORM
    heading += ((turnRate + fadeRate) * Math.PI) / 180 / steps
    x += Math.sin(heading) * ds
    y += Math.cos(heading) * ds
    points.push({ x: x * mirror, y })
  }
  return { mph, ratio, effectiveTurn, effectiveFade, distance: y, drift: x * mirror, points }
}

export function flightPath(d: FlightNumbers, s: ThrowSettings, steps = 80): Point[] {
  return simulate(d, s, steps).points
}

/** Estimated distance in metres for these numbers and this thrower. */
export function estimatedDistance(d: FlightNumbers, s: ThrowSettings): number {
  return simulate(d, s, 40).distance
}

export function discClass(speed: number): string {
  if (speed <= 3) return 'putter'
  if (speed <= 5) return 'midrange'
  if (speed <= 8) return 'fairway-driver'
  return 'distansedriver'
}

function stabilityWord(d: FlightNumbers): string {
  const stability = d.turn + d.fade
  if (stability <= -1.5) return 'Veldig understabil'
  if (stability <= -0.5) return 'Understabil'
  if (stability < 1) return 'Nøytral'
  if (stability < 2.5) return 'Stabil'
  return 'Overstabil'
}

/** Default name from the numbers, e.g. "Stabil fairway-driver". */
export function autoName(d: FlightNumbers): string {
  return `${stabilityWord(d)} ${discClass(d.speed)}`
}

/** Plain-language summary of how the disc behaves for the thrower it is rated for. */
export function describe(d: FlightNumbers): string {
  const stability = d.turn + d.fade
  let behaviour: string
  if (stability <= -1.5) behaviour = 'veldig understabil: svinger kraftig ut og retter seg ikke opp, lett å kaste for svake armer'
  else if (stability <= -0.5) behaviour = 'understabil: svinger ut tidlig og retter seg så opp'
  else if (stability < 1) behaviour = 'nøytral: flyr rett med en svak avslutning'
  else if (stability < 2.5) behaviour = 'stabil: holder linja og kroker pålitelig tilbake på slutten'
  else behaviour = 'overstabil: står imot vind og kroker hardt tilbake på slutten'
  const glide = d.glide >= 5 ? ', mye glide' : d.glide <= 2 ? ', faller raskt' : ''
  const cls = discClass(d.speed)
  return `${cls[0]?.toUpperCase()}${cls.slice(1)}, ${behaviour}${glide}.`
}

/** How this thrower's arm relates to the disc, for the profile and learn views. */
export function matchNote(d: FlightNumbers, s: ThrowSettings): string {
  const { ratio } = simulate(d, s, 2)
  if (ratio < 0.8) return 'Kastes saktere enn den er laget for: flyr kortere, svinger lite og kroker tidlig.'
  if (ratio < 0.95) return 'Litt under farten den er laget for: noe mer overstabil enn tallene sier.'
  if (ratio <= 1.15) return 'Passer armfarten din: flyr omtrent som tallene sier.'
  if (ratio <= 1.4) return 'Kastes hardere enn den er laget for: svinger mer ut enn tallene sier.'
  return 'Altfor sakte disk for armen din: vil flippe over og miste lengde.'
}
