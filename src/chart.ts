import { flightPath, type Disc, type Point, type ThrowSettings } from './flight'

export const COLORS = ['#4ade80', '#60a5fa', '#f472b6', '#fbbf24', '#a78bfa', '#fb923c', '#2dd4bf', '#f87171']

export function colorFor(index: number): string {
  return COLORS[index % COLORS.length] ?? COLORS[0]!
}

/** Screen sizes in pixels; converted to chart units so they stay constant however far the discs fly. */
const STROKE_PX = 3
const DOT_PX = 4
const FONT_PX = 12
const LABEL_MAX_CHARS = 18

interface Box {
  x: number
  y: number
  w: number
  h: number
}

function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
}

function inside(p: Point, b: Box): boolean {
  return p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h
}

/** Top-down view: thrower at the bottom centre, distance in metres going up. */
export function renderChart(svg: SVGSVGElement, discs: Disc[], settings: ThrowSettings): void {
  const paths = discs.map((d) => ({ disc: d, points: flightPath(d, settings) }))
  const maxY = Math.max(50, ...paths.map((p) => p.points[p.points.length - 1]?.y ?? 0)) * 1.08
  const reach = Math.max(15, ...paths.flatMap((p) => p.points.map((pt) => Math.abs(pt.x)))) * 1.25
  // Fill the on-screen box: widen the view when the box is wider than the flights need.
  const aspect = svg.clientHeight > 0 ? svg.clientWidth / svg.clientHeight : 0.75
  const maxX = Math.max(reach, (maxY * aspect) / 2)
  const width = maxX * 2
  // A box taller than the flights need shows more fairway ahead instead of empty space.
  const height = Math.max(maxY, width / aspect)
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`)

  const unit = svg.clientHeight > 0 ? height / svg.clientHeight : 0.3 // chart units per screen pixel
  const stroke = STROKE_PX * unit
  const dot = DOT_PX * unit
  const font = FONT_PX * unit
  const charWidth = font * 0.6

  const parts: string[] = [`<rect width="${width}" height="${height}" fill="#161616"/>`]
  // Lengthwise grid every 25 m, labelled on the right.
  for (let m = 25; m < height; m += 25) {
    const y = height - m
    parts.push(`<line x1="0" x2="${width}" y1="${y}" y2="${y}" stroke="#2a2a2a" stroke-width="${(unit).toFixed(2)}"/>`)
    parts.push(`<text x="${(width - unit * 6).toFixed(1)}" y="${(y - unit * 4).toFixed(1)}" fill="#666" font-size="${(font * 0.9).toFixed(2)}" text-anchor="end">${m} m</text>`)
  }
  // Sideways grid every 10 m, labelled along the bottom; the centre line is the throw direction.
  const sideStep = maxX > 60 ? 20 : 10
  for (let m = -Math.floor(maxX / sideStep) * sideStep; m <= maxX; m += sideStep) {
    const x = maxX + m
    if (m === 0) {
      parts.push(`<line x1="${x}" x2="${x}" y1="0" y2="${height}" stroke="#3a3a3a" stroke-width="${unit.toFixed(2)}" stroke-dasharray="${(unit * 6).toFixed(1)} ${(unit * 6).toFixed(1)}"/>`)
      continue
    }
    parts.push(`<line x1="${x}" x2="${x}" y1="0" y2="${height}" stroke="#222" stroke-width="${unit.toFixed(2)}"/>`)
    parts.push(`<text x="${x.toFixed(1)}" y="${(height - unit * 5).toFixed(1)}" fill="#555" font-size="${(font * 0.8).toFixed(2)}" text-anchor="middle">${m > 0 ? `${m} →` : `← ${-m}`}</text>`)
  }

  // Screen-space copies of every path point, for label collision checks.
  const screenPaths: Point[][] = paths.map(({ points }) => points.map((p) => ({ x: maxX + p.x, y: height - p.y })))
  screenPaths.forEach((points, i) => {
    const d = points.map((p, j) => `${j === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ')
    parts.push(`<path d="${d}" fill="none" stroke="${colorFor(i)}" stroke-width="${stroke.toFixed(2)}" stroke-linecap="round"/>`)
  })

  // Landing labels: try spots around the dot and keep the one crossing the fewest lines and labels.
  const placed: Box[] = []
  const gap = dot * 2
  paths.forEach(({ disc, points }, i) => {
    const end = points[points.length - 1] ?? { x: 0, y: 0 }
    const cx = maxX + end.x
    const cy = height - end.y
    const name = disc.name.length > LABEL_MAX_CHARS ? `${disc.name.slice(0, LABEL_MAX_CHARS - 1)}…` : disc.name
    const text = `${name} · ${Math.round(end.y)} m`
    const w = text.length * charWidth
    const h = font
    const candidates: { box: Box; preference: number }[] = [
      { box: { x: cx - w / 2, y: cy - gap - h, w, h }, preference: 0 }, // above
      { box: { x: cx + gap, y: cy - h / 2, w, h }, preference: 1 }, // right
      { box: { x: cx - gap - w, y: cy - h / 2, w, h }, preference: 1 }, // left
      { box: { x: cx + gap, y: cy - gap - h, w, h }, preference: 2 }, // above right
      { box: { x: cx - gap - w, y: cy - gap - h, w, h }, preference: 2 }, // above left
      { box: { x: cx - w / 2, y: cy + gap, w, h }, preference: 3 }, // below
    ]
    let best = candidates[0]!
    let bestScore = Infinity
    for (const candidate of candidates) {
      const box = candidate.box
      // Slide inside the chart rather than clipping.
      box.x = Math.min(Math.max(box.x, unit * 4), width - w - unit * 4)
      box.y = Math.min(Math.max(box.y, unit * 4), height - h - unit * 4)
      let score = candidate.preference
      for (const path of screenPaths) for (const p of path) if (inside(p, box)) score += 4
      for (const other of placed) if (overlaps(box, other)) score += 40
      if (score < bestScore) {
        bestScore = score
        best = candidate
      }
    }
    placed.push(best.box)
    const color = colorFor(i)
    parts.push(`<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${dot.toFixed(2)}" fill="${color}"/>`)
    parts.push(
      `<text x="${best.box.x.toFixed(1)}" y="${(best.box.y + h * 0.8).toFixed(1)}" fill="${color}" font-size="${font.toFixed(2)}" paint-order="stroke" stroke="#161616" stroke-width="${(unit * 3).toFixed(2)}">${escapeXml(text)}</text>`,
    )
  })
  svg.innerHTML = parts.join('')
}

function escapeXml(text: string): string {
  return text.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c] ?? c)
}
