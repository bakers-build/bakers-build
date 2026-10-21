/** One ticket section: its id, and the document headings it groups. */
export interface TicketSection {
  readonly id: 'overview' | 'planning' | 'comments' | 'related' | 'runs';
  readonly headings: readonly string[];
}

// Document grouping only. Navigation order and labels belong to route metadata.
// The numeric projection remains for existing pure component callers during the
// screen migration; no screen switches between these groups.
const HEADINGS: Record<TicketSection['id'], readonly string[]> = {
  // BB-255 AC-3/D3: `Parent` and `Links` come FIRST, so both are visible in the
  // freshly opened frame without scrolling and without expanding anything — AC-3
  // is this array and nothing else. Parent before Links because the parent is
  // where the ticket SITS in the work hierarchy (context) while links are
  // outbound artifacts of it. `Description` renders as one collapsible entry (see
  // `ticket-detail`'s `EXPANDABLE_HEADINGS`), and `Assignment` keeps its BB-233
  // position immediately after it. Pending reviews sits between Assignment and
  // Time when the current document carries submitted reviews. BB-308: `Time`
  // follows that pair — a section no entry lists is invisible in the TTY
  // rendering even though the flat `bakers ui BB-308 | cat` render still shows it.
  // BB-369 D3/D4: `Latest summary` sits directly ABOVE `Description` and is
  // collapsible through the same `EXPANDABLE_HEADINGS` path. Above, because the
  // newest phase handoff says where the work STANDS while the description says
  // what it is — an operator opening a ticket mid-flight reads the first.
  // BB-381 D2/D3: `Latest spec` then `Latest plan` between summary and
  // Description. Both are listed here so Overview can expand them when present;
  // `detailSections` only pushes them when a matching comment exists, and
  // `sectionsForTab` drops the rest — so Overview `selectable` is `2 + N`
  // (N = how many of {spec, plan} exist). Entry 0 stays Latest summary.
  // BB-678: `Source` joins `Parent` here too — `sectionsForTab`'s only way to
  // reach the pipe (`ticket-detail.ts`'s `fullNonInteractive` renders the
  // overview tab's sections, not `related`'s), and no code reads it back out
  // of `byHeading` for the interactive Overview body, so it is otherwise inert.
  overview: [
    'Source',
    'Parent',
    'Links',
    'Latest summary',
    'Latest spec',
    'Latest plan',
    'Description',
    'Assignment',
    'Pending reviews',
    'Time',
    'Branch',
    'Environments',
  ],
  // Planning has its own model (spec/plan/test), so no headings here.
  planning: [],
  // Comments has its own view function (collapsible entries), so no headings.
  comments: [],
  // BB-255 AC-5: the parent belongs here as much as on Overview. The same
  // section appearing twice falls out of `sectionsForTab`'s heading lookup.
  // BB-369 D5: `Blocked by` between `Sub-tickets` and `Referenced tickets` —
  // grouped with the other relationship sections, and the only one of the three
  // rendered as identity rows rather than a count (see `blockedByLines`).
  // BB-678: `Source` FIRST — the upstream ticket this one was imported from
  // (`bb_ticket.origin`), a plain attribute rather than a relationship.
  related: [
    'Source',
    'Parent',
    'Sub-tickets',
    'Blocked by',
    'Referenced tickets',
  ],
  // BB-255 AC-6: the shared run table, with selectable rows — not a section.
  runs: [],
};

/** Legacy component projection; route metadata owns the tab bar. */
export const TICKET_SECTIONS: readonly TicketSection[] = (
  Object.entries(HEADINGS) as [TicketSection['id'], readonly string[]][]
).map(([id, headings]) => ({ id, headings }));
