/**
 * @file
 * Period range: calendar date math and the Alpine component `periodRange`.
 *
 * The pure functions mirror the server's PeriodResolver (bb_core): UTC
 * calendar periods, ISO weeks Monday–Sunday, and a comparison period that is
 * the previous period of the same kind, or for a custom range the same number
 * of days directly before it. tests/contract/period-range.mjs keeps both
 * sides in agreement.
 *
 * The `.src.js` suffix keeps SDC from attaching this ES module as a classic
 * library (see option_picker.src.js); it reaches the browser through
 * js/alpine.src.js.
 */

const DAY = 86400000
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
export const KINDS = ['week', 'month', 'quarter', 'year', 'all', 'custom']
const KIND_LABELS = { week: 'Week', month: 'Month', quarter: 'Quarter', year: 'Year', all: 'All time', custom: 'Custom' }

const parse = (iso) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '')
  if (!match) return null
  const date = new Date(Date.UTC(+match[1], +match[2] - 1, +match[3]))
  return date.getUTCMonth() === +match[2] - 1 ? date : null
}
const iso = (date) => date.toISOString().slice(0, 10)
const utc = (year, month, day) => new Date(Date.UTC(year, month, day))
const addDays = (date, days) => new Date(date.getTime() + days * DAY)
const days = (range) => Math.round((parse(range.end) - parse(range.start)) / DAY) + 1
const dayCountLabel = (count) => (count === 1 ? 'day' : `${count} days`)
const usable = (element) => Boolean(element) && !element.disabled && element.offsetParent !== null

/**
 * The week, month, quarter or year containing a day.
 */
export function periodOf(kind, dateIso) {
  const date = parse(dateIso)
  const year = date.getUTCFullYear()
  const month = date.getUTCMonth()
  if (kind === 'week') {
    const start = addDays(date, -((date.getUTCDay() + 6) % 7))
    return { start: iso(start), end: iso(addDays(start, 6)) }
  }
  if (kind === 'month') return { start: iso(utc(year, month, 1)), end: iso(utc(year, month + 1, 0)) }
  if (kind === 'quarter') {
    const first = month - (month % 3)
    return { start: iso(utc(year, first, 1)), end: iso(utc(year, first + 3, 0)) }
  }
  return { start: iso(utc(year, 0, 1)), end: iso(utc(year, 11, 31)) }
}

/**
 * The period one step before (-1) or after (+1); custom moves by its length.
 */
export function shift(kind, range, direction) {
  if (kind === 'custom') {
    const length = days(range) * direction
    return { start: iso(addDays(parse(range.start), length)), end: iso(addDays(parse(range.end), length)) }
  }
  const start = parse(range.start)
  const year = start.getUTCFullYear()
  const month = start.getUTCMonth()
  const anchor = {
    week: () => addDays(start, 7 * direction),
    month: () => utc(year, month + direction, 1),
    quarter: () => utc(year, month + 3 * direction, 1),
    year: () => utc(year + direction, 0, 1),
  }[kind]()
  return periodOf(kind, iso(anchor))
}

/**
 * The comparison period, or null for All time.
 */
export function comparisonOf(kind, range) {
  return kind === 'all' ? null : shift(kind, range, -1)
}

const day = (date, withYear) => `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}${withYear ? ` ${date.getUTCFullYear()}` : ''}`

/**
 * The human label of a period: "19 – 25 Oct", "Sep 2026", "Q3 2026", "2025".
 */
export function labelOf(kind, range) {
  const start = parse(range.start)
  const end = parse(range.end)
  if (kind === 'all') return 'All time'
  if (kind === 'month') return `${MONTHS[start.getUTCMonth()]} ${start.getUTCFullYear()}`
  if (kind === 'quarter') return `Q${Math.floor(start.getUTCMonth() / 3) + 1} ${start.getUTCFullYear()}`
  if (kind === 'year') return String(start.getUTCFullYear())
  if (range.start === range.end) return day(start, true)
  const sameYear = start.getUTCFullYear() === end.getUTCFullYear()
  if (kind === 'week' && sameYear && start.getUTCMonth() === end.getUTCMonth()) {
    return `${start.getUTCDate()} – ${day(end, false)}`
  }
  return sameYear ? `${day(start, false)} – ${day(end, false)}` : `${day(start, true)} – ${day(end, true)}`
}

/**
 * The grid position an arrow key moves to, or null when there is none.
 *
 * Left/Right step through the cells in reading order, Up/Down stay in the
 * column; both skip cells that are blank or disabled.
 *
 * @param {boolean[][]} rows
 *   Whether each cell can take focus.
 * @param {number[]} position
 *   The focused [row, column].
 * @param {string} key
 *   The arrow key.
 */
export function gridTarget(rows, [row, column], key) {
  if (key === 'ArrowUp' || key === 'ArrowDown') {
    const step = key === 'ArrowUp' ? -1 : 1
    for (let r = row + step; r >= 0 && r < rows.length; r += step) {
      if (rows[r][column]) return [r, column]
    }
    return null
  }
  const flat = rows.flatMap((cells, r) => cells.map((focusable, c) => ({ r, c, focusable })))
  const index = flat.findIndex(({ r, c }) => r === row && c === column)
  const step = key === 'ArrowLeft' ? -1 : 1
  for (let i = index + step; i >= 0 && i < flat.length; i += step) {
    if (flat[i].focusable) return [flat[i].r, flat[i].c]
  }
  return null
}

/**
 * Alpine component state for the period-range template.
 *
 * @param {object} config
 *   kind, date, start, end, today (YYYY-MM-DD), open and submit (whether a
 *   navigation submits the enclosing GET form).
 */
export default function periodRange(config = {}) {
  const today = parse(config.today) ? config.today : iso(new Date())
  let kind = KINDS.includes(config.kind) ? config.kind : 'week'
  // An unusable custom range falls back to the current week, as on the server.
  if (kind === 'custom' && !(parse(config.start) && parse(config.end) && config.start <= config.end)) kind = 'week'
  const range = kind === 'custom'
    ? { start: config.start, end: config.end }
    : kind === 'all' ? { start: today, end: today } : periodOf(kind, parse(config.date) ? config.date : today)

  const open = config.open || null
  return {
    kind,
    range,
    today,
    draft: { ...range },
    open,
    rovingDay: null,
    // A popover opens on the month of the date it shows.
    view: (open === 'from' ? range.start : open === 'to' ? range.end : kind === 'all' ? today : range.start).slice(0, 7),
    submit: Boolean(config.submit),
    kinds: KINDS,

    get label() {
      const text = labelOf(this.kind, this.range)
      return this.isCurrent && this.kind !== 'custom' && this.kind !== 'all'
        ? `This ${this.kind} · ${text}`
        : text
    },
    get comparisonLabel() {
      const comparison = comparisonOf(this.kind, this.range)
      return comparison ? `vs. ${labelOf(this.kind, comparison)}` : ''
    },
    get isCurrent() {
      return this.range.start <= this.today && this.today <= this.range.end
    },
    get prevLabel() {
      return `Previous ${this.kind === 'custom' ? dayCountLabel(days(this.range)) : this.kind}`
    },
    get nextLabel() {
      return `Next ${this.kind === 'custom' ? dayCountLabel(days(this.range)) : this.kind}`
    },
    get returnLabel() {
      return `Return to this ${this.kind}`
    },
    get canReturn() {
      return ['week', 'month', 'quarter', 'year'].includes(this.kind) && !this.isCurrent
    },
    get dayCount() {
      const count = days(this.range)
      return `${count} ${count === 1 ? 'day' : 'days'}`
    },
    get nextDisabled() {
      if (this.kind === 'all') return true
      // A custom range must stay in the past as a whole; a calendar period may
      // be the running one.
      const next = shift(this.kind, this.range, 1)
      return (this.kind === 'custom' ? next.end : next.start) > this.today
    },
    get applyDisabled() {
      return !this.draft.start || !this.draft.end || this.draft.start > this.draft.end
    },

    kindLabel(value) {
      return KIND_LABELS[value]
    },
    /** The current period of a kind, shown beside it in the kind menu. */
    kindHint(value) {
      if (value === 'all') return ''
      if (value === 'custom') return 'from – to'
      return labelOf(value, periodOf(value, this.today))
    },
    setKind(value) {
      this.kind = value
      if (value === 'all') this.range = { start: this.today, end: this.today }
      else if (value === 'custom') this.draft = { ...this.range }
      else this.range = periodOf(value, this.today)
      this.view = this.range.start.slice(0, 7)
      this.close()
      if (value !== 'custom') this.navigated()
    },
    step(direction) {
      this.range = shift(this.kind, this.range, direction)
      this.draft = { ...this.range }
      if (this.open) this.view = (this.open === 'to' ? this.range.end : this.range.start).slice(0, 7)
      this.keepFocus()
      this.navigated()
    },
    pick(range) {
      this.range = range
      this.draft = { ...range }
      this.close()
      this.navigated()
    },
    pickDay(value) {
      if (this.open === 'from' || this.open === 'to') {
        this.draft = { ...this.draft, [this.open === 'from' ? 'start' : 'end']: value }
        this.close()
        return
      }
      this.pick(periodOf(this.kind, value))
    },
    returnToCurrent() {
      this.range = periodOf(this.kind, this.today)
      this.draft = { ...this.range }
      this.keepFocus()
      this.navigated()
    },
    apply() {
      if (this.applyDisabled) return
      this.range = { ...this.draft }
      this.navigated()
    },
    toggle(which) {
      if (this.open === which) {
        this.close()
        return
      }
      this.open = which
      this.rovingDay = null
      const anchor = which === 'from' ? this.draft.start : which === 'to' ? this.draft.end : this.range.start
      this.view = (anchor || this.today).slice(0, 7)
      // Focus moves into the popover, onto its chosen entry; hidden parts of
      // a popover (the other picker kinds) never take it.
      this.$nextTick?.(() => {
        const popover = which === 'kind'
          ? this.$refs.kindList
          : [...this.$root.querySelectorAll('[role="dialog"]')].find((dialog) => dialog.offsetParent !== null)
        const buttons = popover ? [...popover.querySelectorAll('button')].filter(usable) : []
        // The heading's paging buttons come first in the DOM but are not entries.
        const content = buttons.filter((button) => !/^(Previous|Next) (year|month)$/.test(button.getAttribute('aria-label') || ''))
        const chosen = content.find((button) => button.matches('[aria-selected="true"], [aria-pressed="true"], [tabindex="0"]'))
        ;(chosen || content.find((button) => button.matches('[aria-current="date"]')) || content[0] || buttons[0])?.focus()
      })
    },
    close() {
      const closed = this.open
      this.open = null
      // Focus returns to the trigger of the popover that closed.
      if (closed && this.$refs?.[`${closed}Trigger`]) this.$refs[`${closed}Trigger`].focus()
    },

    /** Moves the shown month (week, from, to) or year; never past today. */
    viewStep(direction) {
      const [year, month] = this.view.split('-').map(Number)
      const yearly = ['month', 'quarter', 'year'].includes(this.kind) && this.open === 'picker'
      const view = iso(yearly ? utc(year + direction, month - 1, 1) : utc(year, month - 1 + direction, 1)).slice(0, 7)
      const limit = yearly ? `${this.today.slice(0, 4)}-12` : this.today.slice(0, 7)
      this.view = view > limit ? this.view : view
      this.rovingDay = null
    },
    get viewLabel() {
      const [year, month] = this.view.split('-').map(Number)
      if (this.open === 'picker' && this.kind === 'year') return `${year - 4} – ${year}`
      if (this.open === 'picker' && ['month', 'quarter'].includes(this.kind)) return String(year)
      return `${MONTH_NAMES[month - 1]} ${year}`
    },
    /** ISO-week rows of the shown month; days outside it are null. */
    get weeks() {
      const [year, month] = this.view.split('-').map(Number)
      const first = utc(year, month - 1, 1)
      const last = utc(year, month, 0)
      const rows = []
      for (let monday = parse(periodOf('week', iso(first)).start); monday <= last; monday = addDays(monday, 7)) {
        const thursday = addDays(monday, 3)
        const yearStart = utc(thursday.getUTCFullYear(), 0, 1)
        const week = Math.floor((thursday - yearStart) / DAY / 7) + 1
        const cells = []
        for (let offset = 0; offset < 7; offset++) {
          const date = addDays(monday, offset)
          const value = iso(date)
          cells.push(date.getUTCMonth() === month - 1 ? { value, day: date.getUTCDate(), today: value === this.today, disabled: value > this.today } : null)
        }
        const start = iso(monday)
        rows.push({ week, start, selected: this.kind === 'week' && this.range.start === start, disabled: start > this.today, cells })
      }
      return rows
    },
    /** Month, quarter or year cells of the shown year (window). */
    get cells() {
      const year = Number(this.view.slice(0, 4))
      const cell = (kind, range, label, sub) => ({
        range, label, sub,
        selected: this.kind === kind && this.range.start === range.start,
        today: range.start <= this.today && this.today <= range.end,
        disabled: range.start > this.today,
      })
      if (this.kind === 'month') {
        return MONTHS.map((name, index) => cell('month', periodOf('month', iso(utc(year, index, 1))), name))
      }
      if (this.kind === 'quarter') {
        return [0, 1, 2, 3].map((q) => cell('quarter', periodOf('quarter', iso(utc(year, q * 3, 1))), `Q${q + 1}`, `${MONTHS[q * 3]} – ${MONTHS[q * 3 + 2]}`))
      }
      return [4, 3, 2, 1, 0].map((back) => cell('year', periodOf('year', `${year - back}-01-01`), String(year - back)))
    },
    /** The accessible name of a day cell: "Thursday, 1 October 2026". */
    dayLabel(value) {
      const date = parse(value)
      const weekday = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][date.getUTCDay()]
      return `${weekday}, ${date.getUTCDate()} ${MONTH_NAMES[date.getUTCMonth()]} ${date.getUTCFullYear()}`
    },
    /**
     * One tab stop per day grid (roving tabindex): the chosen day if shown,
     * else today, else the first enabled day of the shown month.
     */
    dayTabindex(value) {
      // Mirrors the buttons' disabled state: the week picker disables whole weeks.
      const picker = this.open === 'picker'
      const shown = this.weeks
        .flatMap((row) => row.cells.filter((cell) => cell && !(picker ? row.disabled : cell.disabled)))
        .map((cell) => cell.value)
      const chosen = this.open === 'from' ? this.draft.start : this.open === 'to' ? this.draft.end : this.range.start
      const stop = [this.rovingDay, chosen, this.today].find((candidate) => shown.includes(candidate)) ?? shown[0]
      return value === stop ? 0 : -1
    },
    /** Display of a custom date field: DD.MM.YYYY. */
    formatField(value) {
      return value ? value.split('-').reverse().join('.') : ''
    },
    fieldLabel(which) {
      const value = which === 'from' ? this.draft.start : this.draft.end
      return `${which === 'from' ? 'From' : 'To'}, ${value ? day(parse(value), true) : 'not set'}`
    },
    /** Arrow keys move focus by grid position across a grid or list. */
    moveFocus(event, columns = 1) {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return
      const container = event.currentTarget
      const rows = [...container.querySelectorAll('[role="row"]')].filter((row) => row.querySelector('[role="gridcell"]'))
      const focusable = (button) => (button && !button.disabled ? button : null)
      let cells
      if (rows.length) {
        cells = rows.map((row) => [...row.querySelectorAll('[role="gridcell"]')].map((cell) => focusable(cell.querySelector('button'))))
      }
      else {
        const buttons = [...container.querySelectorAll('button')].map(focusable)
        cells = []
        for (let i = 0; i < buttons.length; i += columns) cells.push(buttons.slice(i, i + columns))
      }
      const row = cells.findIndex((r) => r.includes(document.activeElement))
      if (row < 0) return
      const target = gridTarget(cells.map((r) => r.map(Boolean)), [row, cells[row].indexOf(document.activeElement)], event.key)
      event.preventDefault()
      if (!target) return
      cells[target[0]][target[1]].focus()
      // In a day grid the DOM rows are the `weeks` rows, so the tab stop can follow.
      if (rows.length && rows.length === this.weeks.length) this.rovingDay = this.weeks[target[0]].cells[target[1]]?.value ?? null
    },

    /**
     * A step can disable or hide the control that has focus (Next at today,
     * Return once current); focus then moves to the period itself.
     */
    keepFocus() {
      if (!this.$nextTick) return
      const before = document.activeElement
      this.$nextTick(() => {
        const active = document.activeElement === document.body ? before : document.activeElement
        if (usable(active) && this.$root.contains(active)) {
          if (document.activeElement !== active) active.focus()
          return
        }
        ;[this.$refs.pickerTrigger, this.$refs.fromTrigger, this.$refs.kindTrigger].find(usable)?.focus()
      })
    },

    navigated() {
      if (this.submit && this.$nextTick) this.$nextTick(() => this.$root.requestSubmit())
    },
  }
}
