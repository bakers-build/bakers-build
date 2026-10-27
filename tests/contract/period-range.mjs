// node tests/contract/period-range.mjs
// The period-range component's date math must agree with the server's
// PeriodResolver: calendar-aligned UTC ranges and the directly preceding
// comparison period.
import assert from 'node:assert/strict'
import periodRange, { periodOf, shift, comparisonOf, labelOf, gridTarget } from '../../web/themes/custom/bb_theme/components/period-range/period-range.src.js'

const range = (start, end) => ({ start, end })

assert.deepEqual(periodOf('week', '2026-10-24'), range('2026-10-19', '2026-10-25'))
assert.deepEqual(periodOf('week', '2026-10-19'), range('2026-10-19', '2026-10-25'), 'a Monday starts its own week')
assert.deepEqual(periodOf('week', '2027-01-01'), range('2026-12-28', '2027-01-03'), 'ISO week across the year boundary')
assert.deepEqual(periodOf('month', '2028-02-10'), range('2028-02-01', '2028-02-29'))
assert.deepEqual(periodOf('quarter', '2026-11-05'), range('2026-10-01', '2026-12-31'))
assert.deepEqual(periodOf('year', '2026-06-01'), range('2026-01-01', '2026-12-31'))

assert.deepEqual(comparisonOf('week', periodOf('week', '2026-10-24')), range('2026-10-12', '2026-10-18'))
assert.deepEqual(comparisonOf('month', periodOf('month', '2028-03-31')), range('2028-02-01', '2028-02-29'), 'no overflow past the leap day')
assert.deepEqual(comparisonOf('quarter', periodOf('quarter', '2026-11-05')), range('2026-07-01', '2026-09-30'))
assert.deepEqual(comparisonOf('year', periodOf('year', '2026-06-01')), range('2025-01-01', '2025-12-31'))
assert.deepEqual(comparisonOf('custom', range('2026-10-01', '2026-10-10')), range('2026-09-21', '2026-09-30'))
assert.equal(comparisonOf('all', range('2024-10-24', '2026-10-24')), null)

assert.deepEqual(shift('week', periodOf('week', '2026-10-24'), 1), range('2026-10-26', '2026-11-01'))
assert.deepEqual(shift('month', periodOf('month', '2026-01-31'), 1), range('2026-02-01', '2026-02-28'))
assert.deepEqual(shift('month', periodOf('month', '2026-03-15'), -1), range('2026-02-01', '2026-02-28'))
assert.deepEqual(shift('quarter', periodOf('quarter', '2026-11-05'), 1), range('2027-01-01', '2027-03-31'))
assert.deepEqual(shift('year', periodOf('year', '2026-06-01'), -1), range('2025-01-01', '2025-12-31'))
assert.deepEqual(shift('custom', range('2026-10-01', '2026-10-10'), 1), range('2026-10-11', '2026-10-20'), 'custom moves by its own length')
assert.deepEqual(shift('custom', range('2026-10-01', '2026-10-10'), -1), range('2026-09-21', '2026-09-30'))

assert.equal(labelOf('week', range('2026-10-19', '2026-10-25')), '19 – 25 Oct')
assert.equal(labelOf('week', range('2026-09-28', '2026-10-04')), '28 Sep – 4 Oct')
assert.equal(labelOf('week', range('2026-12-28', '2027-01-03')), '28 Dec 2026 – 3 Jan 2027')
assert.equal(labelOf('month', range('2026-09-01', '2026-09-30')), 'Sep 2026')
assert.equal(labelOf('quarter', range('2026-07-01', '2026-09-30')), 'Q3 2026')
assert.equal(labelOf('year', range('2025-01-01', '2025-12-31')), '2025')
assert.equal(labelOf('all', range('2024-10-24', '2026-10-24')), 'All time')
assert.equal(labelOf('custom', range('2026-07-14', '2026-08-31')), '14 Jul – 31 Aug')
assert.equal(labelOf('custom', range('2025-12-01', '2026-01-10')), '1 Dec 2025 – 10 Jan 2026')

// The Alpine state the template binds to, without Alpine.
const week = periodRange({ kind: 'week', date: '2026-10-24', today: '2026-10-24' })
assert.equal(week.label, 'This week · 19 – 25 Oct')
assert.equal(week.comparisonLabel, 'vs. 12 – 18 Oct')
assert.equal(week.prevLabel, 'Previous week')
assert.equal(week.nextLabel, 'Next week')
assert.equal(week.isCurrent, true)
assert.equal(week.nextDisabled, true, 'the next week starts after today')
week.step(-1)
assert.deepEqual(week.range, range('2026-10-12', '2026-10-18'))
assert.equal(week.isCurrent, false)
assert.equal(week.label, '12 – 18 Oct')
assert.equal(week.returnLabel, 'Return to this week')
week.returnToCurrent()
assert.deepEqual(week.range, range('2026-10-19', '2026-10-25'))
week.setKind('quarter')
assert.deepEqual(week.range, range('2026-10-01', '2026-12-31'))
assert.equal(week.label, 'This quarter · Q4 2026')
week.setKind('all')
assert.equal(week.comparisonLabel, '')

const custom = periodRange({ kind: 'custom', start: '2026-09-01', end: '2026-10-19', today: '2026-10-24' })
assert.equal(custom.dayCount, '49 days')
assert.equal(custom.comparisonLabel, 'vs. 14 Jul – 31 Aug')
assert.equal(custom.prevLabel, 'Previous 49 days')
custom.draft = range('2026-10-01', '2026-10-10')
custom.apply()
assert.deepEqual(custom.range, range('2026-10-01', '2026-10-10'))
assert.equal(custom.dayCount, '10 days')

const fallback = periodRange({ kind: 'month', date: 'not-a-date', today: '2026-10-24' })
assert.deepEqual(fallback.range, range('2026-10-01', '2026-10-31'), 'an unusable date anchors on today')

// A popover opens on the month of the date it edits.
assert.equal(periodRange({ kind: 'custom', start: '2026-09-01', end: '2026-10-19', today: '2026-10-24', open: 'from' }).view, '2026-09')
assert.equal(periodRange({ kind: 'month', date: '2026-08-10', today: '2026-10-24', open: 'picker' }).view, '2026-08')

// Arrow keys move by grid position, skipping blank and disabled cells.
// October 2026: Thu 1 starts the first row; 25 Oct onward is in the future.
const october = [
  [false, false, false, true, true, true, true],
  [true, true, true, true, true, true, true],
  [true, true, true, true, true, true, true],
  [true, true, true, true, true, true, true],
  [true, true, true, true, true, true, false],
]
assert.deepEqual(gridTarget(october, [1, 0], 'ArrowUp'), null, 'nothing focusable above Mon 5')
assert.deepEqual(gridTarget(october, [1, 3], 'ArrowUp'), [0, 3], 'Thu 8 up to Thu 1')
assert.deepEqual(gridTarget(october, [0, 3], 'ArrowLeft'), null)
assert.deepEqual(gridTarget(october, [1, 0], 'ArrowLeft'), [0, 6], 'Mon 5 left wraps to Sun 4')
assert.deepEqual(gridTarget(october, [3, 6], 'ArrowDown'), null, 'Sun 25 below Sun 18 is disabled')
assert.deepEqual(gridTarget(october, [4, 5], 'ArrowRight'), null, 'Sun 25 is disabled')
assert.deepEqual(gridTarget(october, [2, 2], 'ArrowDown'), [3, 2])

// A custom range never steps past today; one day reads as one day.
const pastCustom = periodRange({ kind: 'custom', start: '2026-09-01', end: '2026-10-19', today: '2026-10-24' })
assert.equal(pastCustom.nextDisabled, true, 'the next 49 days would end after today')
assert.equal(periodRange({ kind: 'custom', start: '2026-09-01', end: '2026-09-10', today: '2026-10-24' }).nextDisabled, false)
const oneDay = periodRange({ kind: 'custom', start: '2026-10-23', end: '2026-10-23', today: '2026-10-24' })
assert.equal(oneDay.prevLabel, 'Previous day')
assert.equal(oneDay.comparisonLabel, 'vs. 22 Oct 2026')
assert.equal(labelOf('custom', range('2025-12-31', '2025-12-31')), '31 Dec 2025')

// Stepping with a calendar open keeps the calendar on the shown date.
const stepping = periodRange({ kind: 'custom', start: '2026-09-01', end: '2026-10-19', today: '2026-10-24', open: 'from' })
stepping.step(-1)
assert.equal(stepping.view, '2026-07')

// Pickers page by one month or year and never into a fully future page.
const years = periodRange({ kind: 'year', date: '2024-03-01', today: '2026-10-24', open: 'picker' })
years.view = '2026-01'
years.viewStep(1)
assert.equal(years.view.slice(0, 4), '2026', 'no page after the current year')
years.viewStep(-1)
assert.equal(years.view.slice(0, 4), '2025')
assert.deepEqual(years.cells.map((cell) => cell.label), ['2021', '2022', '2023', '2024', '2025'])
const weeks = periodRange({ kind: 'week', date: '2026-10-24', today: '2026-10-24', open: 'picker' })
weeks.viewStep(1)
assert.equal(weeks.view, '2026-10', 'no month after the current one')

// Day cells: a full accessible name and a single tab stop.
assert.equal(weeks.dayLabel('2026-10-01'), 'Thursday, 1 October 2026')
assert.equal(weeks.dayTabindex('2026-10-19'), 0, 'the selected week start is the tab stop')
assert.equal(weeks.dayTabindex('2026-10-20'), -1)
const from = periodRange({ kind: 'custom', start: '2026-09-01', end: '2026-10-19', today: '2026-10-24', open: 'from' })
assert.equal(from.dayTabindex('2026-09-01'), 0, 'the edited date is the tab stop')
from.view = '2026-08'
assert.equal(from.dayTabindex('2026-08-01'), 0, 'otherwise the first day of the shown month')

// The tab stop follows the day the arrow keys reached.
weeks.rovingDay = '2026-10-24'
assert.equal(weeks.dayTabindex('2026-10-24'), 0)
assert.equal(weeks.dayTabindex('2026-10-19'), -1)
weeks.viewStep(-1)
assert.equal(weeks.rovingDay, null, 'paging resets the roving day')

// In the week picker a whole running week is selectable, its later days included.
const runningWeek = periodRange({ kind: 'week', date: '2026-10-24', today: '2026-10-24', open: 'picker' })
runningWeek.rovingDay = '2026-10-25'
assert.equal(runningWeek.dayTabindex('2026-10-25'), 0)

console.log('period-range contract: ok')
