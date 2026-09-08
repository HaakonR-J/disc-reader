import './style.css'
import { renderChart, colorFor } from './chart'
import { autoName, describe, estimatedDistance, matchNote, matchedDistance, powerLabel, releaseSpeedMph, type Disc, type FlightNumbers, type ThrowSettings } from './flight'
import { loadDiscs, loadSettings, saveDiscs, saveSettings } from './store'

const RANGES: Record<keyof FlightNumbers, [number, number]> = { speed: [1, 15], glide: [1, 7], turn: [-5, 1], fade: [0, 5] }
const FIELDS: (keyof FlightNumbers)[] = ['speed', 'glide', 'turn', 'fade']
const IMAGE_MAX_SIDE = 512
type View = 'add' | 'compare' | 'learn'
const INSTALL_DISMISSED_KEY = 'disc-reader.install-dismissed'
const FIELD_LABEL: Record<keyof FlightNumbers, string> = { speed: 'Speed', glide: 'Glide', turn: 'Turn', fade: 'Fade' }

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id)
  if (!node) throw new Error(`Missing #${id}`)
  return node as T
}

const form = el<HTMLFormElement>('entry')
const inputs: Record<keyof FlightNumbers, HTMLInputElement> = {
  speed: el<HTMLInputElement>('speed'),
  glide: el<HTMLInputElement>('glide'),
  turn: el<HTMLInputElement>('turn'),
  fade: el<HTMLInputElement>('fade'),
}
const nameInput = el<HTMLInputElement>('name')
const turnSign = el<HTMLButtonElement>('turnSign')
const photoInput = el<HTMLInputElement>('photoInput')
const photoLabel = el<HTMLSpanElement>('photoLabel')
const photoPreview = el<HTMLImageElement>('photoPreview')
const photoClear = el<HTMLButtonElement>('photoClear')
const entryError = el<HTMLParagraphElement>('entryError')
const list = el<HTMLUListElement>('list')
const listEmpty = el<HTMLParagraphElement>('listEmpty')
const count = el<HTMLSpanElement>('count')
const chart = el<SVGSVGElement & HTMLElement>('chart')
const legend = el<HTMLUListElement>('legend')
const selectSheet = el<HTMLDivElement>('selectSheet')
const selectList = el<HTMLUListElement>('selectList')
const settingsSheet = el<HTMLDivElement>('settingsSheet')
const settingsSection = el<HTMLElement>('throwSettings')
const profileSheet = el<HTMLDivElement>('profile')
const tabs = el<HTMLElement>('tabs')
const controls = el<HTMLDivElement>('controls')
const powerSlider = el<HTMLInputElement>('power')
const powerLabelNode = el<HTMLSpanElement>('powerLabel')
const learnChart = el<SVGSVGElement & HTMLElement>('learnChart')
const learnSummary = el<HTMLParagraphElement>('learnSummary')
const learnSliders = el<HTMLDivElement>('learnSliders')
const installBanner = el<HTMLDivElement>('installBanner')

let discs = loadDiscs()
let settings = loadSettings()
let view: View = 'add'
let pendingImage: string | undefined
/** Chart inside the open profile sheet, so the slider can redraw it too. */
let profileChart: SVGSVGElement | null = null
let profileDisc: Disc | null = null
/** The example disc on the learn tab. */
const learnDisc: Disc = { id: 'learn', name: 'Eksempel', speed: 9, glide: 5, turn: -1, fade: 2, compare: true }

function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/** The four numbers, each in its own colour, separated by bars. */
function flightNode(d: FlightNumbers, className: string): HTMLSpanElement {
  const node = document.createElement('span')
  node.className = className
  FIELDS.forEach((field, i) => {
    if (i > 0) {
      const sep = document.createElement('span')
      sep.className = 'sep'
      sep.textContent = '|'
      node.append(sep)
    }
    const value = document.createElement('span')
    value.className = `v-${field}`
    value.textContent = String(d[field])
    node.append(value)
  })
  return node
}

function persist(): void {
  saveDiscs(discs)
  saveSettings(settings)
  renderList()
  if (view === 'compare') renderCompare()
}

// ---------- entry form ----------

function readNumber(field: keyof FlightNumbers): number | null {
  const raw = inputs[field].value.trim().replace(',', '.')
  if (raw === '') return null
  const value = Number(raw)
  const [min, max] = RANGES[field]
  if (!Number.isFinite(value) || value < min || value > max) return null
  return value
}

function readAll(): FlightNumbers | null {
  const speed = readNumber('speed')
  const glide = readNumber('glide')
  const turn = readNumber('turn')
  const fade = readNumber('fade')
  if (speed === null || glide === null || turn === null || fade === null) return null
  return { speed, glide, turn, fade }
}

/** The keypad has no minus key: a bare digit typed into Turn is shown as negative straight away. */
function signTurn(): void {
  const raw = inputs.turn.value.trim()
  if (/^\d/.test(raw) && raw !== '0' && !raw.startsWith('0.')) inputs.turn.value = `-${raw}`
}

function flipTurnSign(): void {
  const raw = inputs.turn.value.trim()
  if (raw === '' || raw === '0') return
  inputs.turn.value = raw.startsWith('-') ? raw.slice(1) : `-${raw}`
  updateNamePlaceholder()
}

function defaultName(): string {
  return `Disk ${discs.length + 1}`
}

function updateNamePlaceholder(): void {
  nameInput.placeholder = defaultName()
}

/** Move to the next field as soon as the typed value cannot grow into another valid number. */
function autoAdvance(field: keyof FlightNumbers): void {
  if (field === 'turn') signTurn()
  updateNamePlaceholder()
  const value = inputs[field].value.trim()
  const complete = field === 'speed' ? /^([2-9]|1[0-5])$/.test(value) : /^[-+]?\d$/.test(value)
  if (!complete) return
  const next = FIELDS[FIELDS.indexOf(field) + 1]
  if (next) inputs[next].focus()
  else nameInput.focus()
}

/** Downscales a picked photo to a small JPEG data URL so it fits in local storage. */
async function imageToDataUrl(file: File): Promise<string> {
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    const scale = Math.min(1, IMAGE_MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(img.naturalWidth * scale)
    canvas.height = Math.round(img.naturalHeight * scale)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas unavailable')
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
    return canvas.toDataURL('image/jpeg', 0.8)
  } finally {
    URL.revokeObjectURL(url)
  }
}

function setPendingImage(image: string | undefined): void {
  pendingImage = image
  photoPreview.hidden = !image
  photoClear.hidden = !image
  photoLabel.textContent = image ? 'Bytt bilde' : 'Bilde'
  if (image) photoPreview.src = image
}

photoInput.addEventListener('change', () => {
  const file = photoInput.files?.[0]
  photoInput.value = ''
  if (!file) return
  imageToDataUrl(file)
    .then(setPendingImage)
    .catch(() => {
      entryError.textContent = 'Kunne ikke lese bildet'
    })
})
photoClear.addEventListener('click', () => setPendingImage(undefined))

function addDisc(numbers: FlightNumbers, name: string, image?: string): Disc {
  const disc: Disc = {
    id: newId(),
    name: name.trim() || defaultName(),
    ...numbers,
    compare: true,
    ...(image ? { image } : {}),
  }
  discs = [disc, ...discs]
  persist()
  return disc
}

form.addEventListener('submit', (event) => {
  event.preventDefault()
  for (const field of FIELDS) {
    if (readNumber(field) === null) {
      entryError.textContent = `${FIELD_LABEL[field]} må være mellom ${RANGES[field][0]} og ${RANGES[field][1]}`
      inputs[field].focus()
      return
    }
  }
  const numbers = readAll()
  if (!numbers) return
  entryError.textContent = ''
  addDisc(numbers, nameInput.value, pendingImage)
  form.reset()
  setPendingImage(undefined)
  updateNamePlaceholder()
  // Close the keyboard so the new disc is visible; the next tap on Speed reopens it.
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
})

for (const field of FIELDS) inputs[field].addEventListener('input', () => autoAdvance(field))
turnSign.addEventListener('click', flipTurnSign)

// ---------- disc list ----------

function thumbnail(disc: Disc): HTMLElement {
  if (disc.image) {
    const img = document.createElement('img')
    img.className = 'thumb'
    img.src = disc.image
    img.alt = ''
    return img
  }
  const box = document.createElement('div')
  box.className = 'thumb'
  box.textContent = String(disc.speed)
  return box
}

function renderList(): void {
  const compared = discs.filter((d) => d.compare)
  list.innerHTML = ''
  for (const disc of discs) {
    const item = document.createElement('li')
    const colorIndex = compared.indexOf(disc)
    item.style.setProperty('--color', colorIndex >= 0 ? colorFor(colorIndex) : '#333')
    const body = document.createElement('div')
    const title = document.createElement('span')
    title.className = 'title'
    title.textContent = disc.name
    const flight = flightNode(disc, 'flight')
    const desc = document.createElement('div')
    desc.className = 'desc'
    desc.textContent = describe(disc)
    body.append(title, flight, desc)
    const chevron = document.createElement('span')
    chevron.className = 'chevron'
    chevron.textContent = '›'
    item.append(thumbnail(disc), body, chevron)
    item.addEventListener('click', () => openProfile(disc))
    list.append(item)
  }
  listEmpty.style.display = discs.length ? 'none' : ''
  count.textContent = discs.length ? `${discs.length} disk${discs.length === 1 ? '' : 'er'}` : ''
}

// ---------- profile sheet ----------

function openProfile(disc: Disc): void {
  const panel = profileSheet.querySelector<HTMLElement>('.panel')
  if (!panel) return
  panel.innerHTML = ''

  const head = document.createElement('div')
  head.className = 'profile-head'
  const image = document.createElement('img')
  image.className = 'profile-image'
  image.alt = ''
  const placeholder = document.createElement('div')
  placeholder.className = 'profile-image'
  placeholder.textContent = String(disc.speed)
  if (disc.image) image.src = disc.image
  else image.style.display = 'none'
  placeholder.style.display = disc.image ? 'none' : ''

  const name = document.createElement('input')
  name.className = 'profile-name'
  name.value = disc.name
  name.placeholder = disc.name
  name.addEventListener('change', () => {
    disc.name = name.value.trim() || disc.name
    name.value = disc.name
    persist()
  })

  const flight = flightNode(disc, 'flight profile-flight')
  flight.style.display = 'block'
  const desc = document.createElement('p')
  desc.className = 'profile-desc'
  desc.textContent = `${describe(disc)} ${matchNote(disc, settings)}`

  const miniChart = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  miniChart.setAttribute('class', 'profile-chart')
  miniChart.setAttribute('preserveAspectRatio', 'xMidYMax meet')

  const compareToggle = document.createElement('label')
  compareToggle.className = 'toggle'
  const check = document.createElement('input')
  check.type = 'checkbox'
  check.checked = disc.compare
  check.addEventListener('change', () => {
    disc.compare = check.checked
    persist()
  })
  compareToggle.append(check, 'Vis i sammenligningen')

  const actions = document.createElement('div')
  actions.className = 'profile-actions'
  const photoButton = document.createElement('label')
  photoButton.className = 'chip'
  photoButton.textContent = disc.image ? 'Bytt bilde' : 'Legg til bilde'
  const photoFile = document.createElement('input')
  photoFile.type = 'file'
  photoFile.accept = 'image/*'
  photoFile.hidden = true
  photoFile.addEventListener('change', () => {
    const file = photoFile.files?.[0]
    photoFile.value = ''
    if (!file) return
    imageToDataUrl(file)
      .then((data) => {
        disc.image = data
        image.src = data
        image.style.display = ''
        placeholder.style.display = 'none'
        photoButton.firstChild!.textContent = 'Bytt bilde'
        persist()
      })
      .catch(() => alert('Kunne ikke lese bildet'))
  })
  photoButton.append(photoFile)
  const remove = document.createElement('button')
  remove.type = 'button'
  remove.className = 'chip danger'
  remove.textContent = 'Slett disk'
  remove.addEventListener('click', () => {
    if (!confirm(`Slette ${disc.name}?`)) return
    discs = discs.filter((d) => d !== disc)
    closeSheets()
    persist()
  })
  actions.append(photoButton, remove)

  const close = document.createElement('button')
  close.type = 'button'
  close.className = 'close'
  close.textContent = 'Lukk'
  close.addEventListener('click', closeSheets)

  head.append(image, placeholder, name)
  panel.append(head, flight, desc, miniChart, compareToggle, actions, close)
  profileSheet.classList.add('open')
  profileChart = miniChart
  profileDisc = disc
  renderChart(miniChart, [disc], settings)
}

// ---------- compare ----------

function renderCompare(): void {
  const compared = discs.filter((d) => d.compare)
  renderChart(chart, compared, settings)
  legend.innerHTML = ''
  compared.forEach((disc, i) => {
    const item = document.createElement('li')
    const swatch = document.createElement('span')
    swatch.className = 'swatch'
    swatch.style.background = colorFor(i)
    item.append(swatch, disc.name)
    legend.append(item)
  })
  if (compared.length === 0) {
    const item = document.createElement('li')
    item.textContent = discs.length ? 'Ingen disker valgt' : 'Legg til en disk først'
    legend.append(item)
  }
}

function renderSelect(): void {
  const compared = discs.filter((d) => d.compare)
  selectList.innerHTML = ''
  for (const disc of discs) {
    const row = document.createElement('label')
    const check = document.createElement('input')
    check.type = 'checkbox'
    check.checked = disc.compare
    check.addEventListener('change', () => {
      disc.compare = check.checked
      persist()
      renderSelect()
    })
    const swatch = document.createElement('span')
    swatch.className = 'swatch'
    const colorIndex = compared.indexOf(disc)
    swatch.style.background = colorIndex >= 0 ? colorFor(colorIndex) : '#333'
    const flight = flightNode(disc, 'flight')
    row.append(check, swatch, disc.name, flight)
    const item = document.createElement('li')
    item.append(row)
    selectList.append(item)
  }
  if (discs.length === 0) {
    const item = document.createElement('li')
    item.className = 'empty'
    item.textContent = 'Legg til en disk først'
    selectList.append(item)
  }
}

function openSelect(): void {
  renderSelect()
  selectSheet.classList.add('open')
}

// ---------- learn tab ----------

function renderLearn(): void {
  for (const slider of learnSliders.querySelectorAll<HTMLInputElement>('input[type="range"]')) {
    const field = slider.dataset['field']
    if (field === 'speed' || field === 'glide' || field === 'turn' || field === 'fade') {
      slider.value = String(learnDisc[field])
      const value = learnSliders.querySelector<HTMLSpanElement>(`[data-value="${field}"]`)
      if (value) value.textContent = String(learnDisc[field])
    }
  }
  renderChart(learnChart, [learnDisc], settings)
  learnSummary.textContent = `${describe(learnDisc)} ${matchNote(learnDisc, settings)} Anslått lengde med din armfart: ${Math.round(estimatedDistance(learnDisc, settings))} m.`
}

learnSliders.addEventListener('input', (event) => {
  const slider = event.target as HTMLInputElement
  const field = slider.dataset['field']
  if (field === 'speed' || field === 'glide' || field === 'turn' || field === 'fade') {
    learnDisc[field] = Number(slider.value)
    learnDisc.name = autoName(learnDisc)
    renderLearn()
  }
})

// ---------- install hint ----------

function isInstalled(): boolean {
  const iosStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true
  return iosStandalone || window.matchMedia('(display-mode: standalone)').matches
}

function renderInstallBanner(): void {
  installBanner.hidden = isInstalled() || localStorage.getItem(INSTALL_DISMISSED_KEY) === '1'
}

el<HTMLButtonElement>('installHow').addEventListener('click', () => {
  el<HTMLDivElement>('installSheet').classList.add('open')
})
el<HTMLButtonElement>('installDismiss').addEventListener('click', () => {
  localStorage.setItem(INSTALL_DISMISSED_KEY, '1')
  renderInstallBanner()
})

// ---------- settings sheet ----------

function renderSettings(): void {
  for (const segment of settingsSection.querySelectorAll<HTMLElement>('.segment')) {
    const key = segment.dataset['key'] as keyof ThrowSettings
    for (const button of segment.querySelectorAll<HTMLButtonElement>('button')) {
      button.classList.toggle('active', button.dataset['value'] === settings[key])
    }
  }
}

settingsSection.addEventListener('click', (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button')
  const segment = button?.closest<HTMLElement>('.segment')
  if (!button || !segment) return
  const key = segment.dataset['key']
  const value = button.dataset['value']
  if (key === 'hand' && (value === 'right' || value === 'left')) settings = { ...settings, hand: value }
  if (key === 'throw' && (value === 'backhand' || value === 'forehand')) settings = { ...settings, throw: value }
  renderSettings()
  persist()
  if (view === 'learn') renderLearn()
})

// ---------- arm speed slider ----------

function powerText(): string {
  const mph = releaseSpeedMph(settings.power)
  return `${powerLabel(settings.power)} · ${Math.round(mph * 1.609)} km/t · ca. ${Math.round(matchedDistance(mph))} m`
}

function renderPower(): void {
  powerSlider.value = String(settings.power)
  powerLabelNode.textContent = powerText()
}

powerSlider.addEventListener('input', () => {
  settings = { ...settings, power: Number(powerSlider.value) }
  powerLabelNode.textContent = powerText()
  if (view === 'compare') renderCompare()
  if (view === 'learn') renderLearn()
  if (profileChart && profileDisc && profileSheet.classList.contains('open')) renderChart(profileChart, [profileDisc], settings)
})
powerSlider.addEventListener('change', () => saveSettings(settings))

// ---------- navigation ----------

function closeSheets(): void {
  for (const sheet of document.querySelectorAll('.sheet')) sheet.classList.remove('open')
  profileChart = null
  profileDisc = null
}

function showView(next: View): void {
  view = next
  for (const section of document.querySelectorAll<HTMLElement>('.view')) section.classList.toggle('active', section.dataset['view'] === next)
  for (const button of tabs.querySelectorAll<HTMLButtonElement>('button')) button.classList.toggle('active', button.dataset['view'] === next)
  controls.style.display = next === 'add' ? 'none' : ''
  if (next === 'compare') renderCompare()
  if (next === 'learn') renderLearn()
}

tabs.addEventListener('click', (event) => {
  const next = (event.target as HTMLElement).closest<HTMLButtonElement>('button')?.dataset['view']
  if (next === 'add' || next === 'compare' || next === 'learn') showView(next)
})
el<HTMLButtonElement>('selectDiscs').addEventListener('click', openSelect)
el<HTMLButtonElement>('settingsButton').addEventListener('click', () => {
  renderSettings()
  settingsSheet.classList.add('open')
})
for (const sheet of document.querySelectorAll<HTMLElement>('.sheet')) {
  sheet.addEventListener('click', (event) => {
    if (event.target === sheet) closeSheets()
  })
  sheet.querySelector<HTMLButtonElement>('.close')?.addEventListener('click', closeSheets)
}
window.addEventListener('resize', () => {
  if (view === 'compare') renderCompare()
  if (view === 'learn') renderLearn()
})

// iOS home-screen apps can be left scrolled up by the keyboard's height after it closes, which
// shows as an empty band under the tab bar. Snap back whenever the keyboard or viewport changes.
function snapToTop(): void {
  window.scrollTo(0, 0)
  document.documentElement.scrollTop = 0
  document.body.scrollTop = 0
}
window.visualViewport?.addEventListener('resize', snapToTop)
window.visualViewport?.addEventListener('scroll', snapToTop)
document.addEventListener('focusout', () => {
  window.setTimeout(snapToTop, 50)
  window.setTimeout(snapToTop, 300)
})

learnDisc.name = autoName(learnDisc)
updateNamePlaceholder()
renderList()
renderSettings()
renderPower()
renderInstallBanner()
showView('add')
