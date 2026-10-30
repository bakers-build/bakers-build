import type { createBbConnectionClient } from '@bakers-build/core';
import { DrupalJsonApiParams } from 'drupal-jsonapi-params';
import { calendar, civilDate, selectedDates, shiftDate } from './dates.js';

type Client = Awaited<ReturnType<typeof createBbConnectionClient>>;
type Row = {
  id: string;
  type: string;
  attributes?: Record<string, unknown>;
  relationships?: Record<string, { data?: { id: string } | unknown[] | null }>;
};
type Selection = { from: string; to: string; timezone?: string };
type Page = {
  data: Row[];
  included?: Row[];
  links?: { next?: string | { href?: string } | null };
  meta?: { omitted?: unknown };
};
const attr = (row: Row, key: string) => row.attributes?.[key];
const relation = (row: Row, key: string): string | null => {
  const value = row.relationships?.[key]?.data;
  return value && !Array.isArray(value) && typeof value.id === 'string'
    ? value.id
    : null;
};
const stamp = (value: unknown): number | null =>
  typeof value === 'string' && Number.isFinite(Date.parse(value))
    ? Date.parse(value)
    : null;
const iso = (time: number) => new Date(time).toISOString();
function rows(value: unknown): value is Row[] {
  return (
    Array.isArray(value) &&
    value.every(
      (row) =>
        row &&
        typeof row === 'object' &&
        typeof row.id === 'string' &&
        typeof row.type === 'string',
    )
  );
}

async function collect(
  client: Pick<Client, 'get'>,
  type: string,
  params: DrupalJsonApiParams,
) {
  const data = new Map<string, Row>();
  const included = new Map<string, Row>();
  let complete = true;
  let offset = 0;
  while (true) {
    params.addPageLimit(50).addPageOffset(offset);
    const raw = await client.get(`${type}/${type}`, params);
    if (!raw || typeof raw !== 'object' || !('data' in raw) || !rows(raw.data))
      throw new Error(`Invalid ${type} collection response.`);
    const page = raw as Page;
    if (page.included !== undefined && !rows(page.included))
      throw new Error(`Invalid ${type} included resources.`);
    if (page.meta?.omitted) complete = false;
    for (const row of page.data) {
      if (row.type !== `${type}--${type}`)
        throw new Error(`Unexpected resource in ${type}.`);
      data.set(row.id, row);
    }
    for (const row of page.included ?? [])
      included.set(`${row.type}/${row.id}`, row);
    if (!page.links?.next) break;
    const href =
      typeof page.links.next === 'string'
        ? page.links.next
        : page.links.next.href;
    if (!href) throw new Error(`Invalid ${type} pagination link.`);
    // Consume only the next offset; keep our authenticated endpoint and filters.
    const next = new URL(href, 'https://pagination.invalid').searchParams.get(
      'page[offset]',
    );
    if (
      next === null ||
      !/^\d+$/.test(next) ||
      !Number.isSafeInteger(Number(next)) ||
      Number(next) <= offset
    )
      throw new Error(`Non-advancing ${type} pagination.`);
    offset = Number(next);
  }
  return {
    data: [...data.values()],
    included: [...included.values()],
    complete,
  };
}

type Worklog = {
  id: string;
  work_date?: unknown;
  state?: unknown;
  duration_seconds?: unknown;
  description?: unknown;
  source_keys?: unknown;
  project_id?: string | null;
  ticket_id?: string | null;
  submission_id?: string | null;
};
type WorklogPage = {
  data: Worklog[];
  projects: { id: string; name?: unknown }[];
  tickets: {
    id: string;
    identifier?: unknown;
    title?: unknown;
    project_id?: string | null;
  }[];
  omitted?: unknown;
  next_offset?: unknown;
};
/** The slice of `@dropsh/plugin-tool`'s ToolClient this reader needs. */
export type WorklogTool = {
  call(
    name: string,
    args: Record<string, unknown>,
  ): Promise<{ structuredContent?: unknown }>;
};
const ided = (value: unknown) =>
  Array.isArray(value) &&
  value.every(
    (row) => row && typeof row === 'object' && typeof row.id === 'string',
  );

/** Page `tool_api__bakers_worklog_list` (the owner's own worklogs) until next_offset is null. */
async function collectWorklogs(tool: WorklogTool, from: string, to: string) {
  const data = new Map<string, Worklog>();
  const tickets = new Map<string, WorklogPage['tickets'][number]>();
  const projects = new Map<string, WorklogPage['projects'][number]>();
  let complete = true;
  let offset = 0;
  while (true) {
    const { structuredContent: page } = await tool.call(
      'tool_api__bakers_worklog_list',
      { from, to, limit: 50, offset },
    );
    if (
      !page ||
      typeof page !== 'object' ||
      !ided((page as WorklogPage).data) ||
      !ided((page as WorklogPage).tickets) ||
      !ided((page as WorklogPage).projects)
    )
      throw new Error('Invalid worklog tool response.');
    const { data: rows, omitted, next_offset: next } = page as WorklogPage;
    if (omitted) complete = false;
    for (const row of rows) data.set(row.id, row);
    for (const row of (page as WorklogPage).tickets) tickets.set(row.id, row);
    for (const row of (page as WorklogPage).projects) projects.set(row.id, row);
    if (next === null || next === undefined) break;
    if (!Number.isSafeInteger(next) || (next as number) <= offset)
      throw new Error('Non-advancing worklog pagination.');
    offset = next as number;
  }
  return {
    data: [...data.values()],
    tickets: [...tickets.values()],
    projects: [...projects.values()],
    complete,
  };
}

function context(params: DrupalJsonApiParams) {
  return params
    .addInclude(['ticket_id.project_id'])
    .addFields('bb_ticket--bb_ticket', ['identifier', 'title', 'project_id'])
    .addFields('bb_project--bb_project', ['name']);
}

export async function loadEvidence(
  client: Client,
  selection: Selection,
  worklogTool: WorklogTool,
) {
  const dates = selectedDates(selection.from, selection.to);
  if (selection.timezone) calendar(selection.timezone);
  const owner = await client.me();
  const user = await client.resource('user', owner);
  const timezone = selection.timezone ?? user.attr<string>('timezone');
  if (!timezone)
    throw new Error('Employee timezone is unavailable; supply --timezone.');
  const { boundary, dateAt } = calendar(timezone);
  const start = boundary(selection.from);
  const end = boundary(shiftDate(selection.to, 1));
  const historyStart = boundary(shiftDate(selection.from, -28));
  const weekday = (date: string) =>
    (new Date(civilDate(date)).getUTCDay() + 6) % 7;
  const weekStart = shiftDate(selection.from, -weekday(selection.from));
  const weekEnd = shiftDate(selection.to, 6 - weekday(selection.to));
  const rawSchedule = user.attr<unknown>('work_schedule');
  const schedule = (
    Array.isArray(rawSchedule) ? rawSchedule[0] : rawSchedule
  ) as Record<string, unknown> | null | undefined;
  const seconds = (value: unknown): number | null =>
    typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
      ? value
      : null;
  const evidenceGaps: string[] = [];

  const runParams = context(new DrupalJsonApiParams())
    .addFilter('owner_user_id.id', owner)
    .addGroup('start', 'OR')
    .addFilter('started_at', String(end / 1000), '<', 'start')
    .addGroup('not_started', 'AND', 'start')
    .addFilter('started_at', null, 'IS NULL', 'not_started')
    .addFilter('created', String(end / 1000), '<', 'not_started')
    .addGroup('end', 'OR')
    .addFilter('closed_date', String(historyStart / 1000), '>=', 'end')
    .addFilter('closed_date', null, 'IS NULL', 'end')
    .addFields('bb_run--bb_run', [
      'owner_user_id',
      'started_at',
      'closed_date',
      'state',
      'state_at_start',
      'ticket_id',
      'conductor_id',
    ])
    .addSort('drupal_internal__id');
  const activityParams = context(new DrupalJsonApiParams())
    .addFilter('created', String(start / 1000), '>=')
    .addFilter('created', String(end / 1000), '<')
    .addGroup('personal', 'OR')
    .addFilter('actor.id', owner, '=', 'personal')
    .addFilter('run_id.owner_user_id.id', owner, '=', 'personal')
    .addInclude(['ticket_id.project_id', 'comment_id', 'run_id'])
    .addFields('bb_run--bb_run', ['owner_user_id'])
    .addFields('bb_activity--bb_activity', [
      'created',
      'kind',
      'actor',
      'run_id',
      'ticket_id',
      'comment_id',
      'previous_state',
      'new_state',
      'step',
    ])
    .addFields('bb_comment--bb_comment', ['body'])
    .addSort('drupal_internal__id');
  const [runPage, activityPage, worklogPage] = await Promise.all([
    collect(client, 'bb_run', runParams),
    collect(client, 'bb_activity', activityParams),
    collectWorklogs(worklogTool, weekStart, weekEnd),
  ]);
  for (const [name, page] of [
    ['runs', runPage],
    ['activities', activityPage],
    ['worklogs', worklogPage],
  ] as const) {
    if (!page.complete)
      evidenceGaps.push(
        `Some ${name} or included resources were omitted by the server.`,
      );
  }
  const tickets: Record<
    string,
    { identifier: unknown; title: unknown; project_id: string | null }
  > = {};
  const projects: Record<string, { name: unknown }> = {};
  const summaries = new Map<string, string>();
  for (const row of [...runPage.included, ...activityPage.included]) {
    if (row.type === 'bb_ticket--bb_ticket')
      tickets[row.id] = {
        identifier: attr(row, 'identifier') ?? null,
        title: attr(row, 'title') ?? null,
        project_id: relation(row, 'project_id'),
      };
    if (row.type === 'bb_project--bb_project')
      projects[row.id] = { name: attr(row, 'name') ?? null };
    if (row.type === 'bb_comment--bb_comment') {
      const body = attr(row, 'body') as { value?: unknown } | undefined;
      if (typeof body?.value === 'string') summaries.set(row.id, body.value);
    }
  }
  for (const ticket of worklogPage.tickets)
    tickets[ticket.id] = {
      identifier: ticket.identifier ?? null,
      title: ticket.title ?? null,
      project_id: ticket.project_id ?? null,
    };
  for (const project of worklogPage.projects)
    projects[project.id] = { name: project.name ?? null };
  const unplaced: string[] = [];
  for (const [id, ticket] of Object.entries(tickets))
    if (ticket.project_id && !projects[ticket.project_id])
      evidenceGaps.push(`Ticket ${id} has unavailable project context.`);
  const runs = runPage.data
    .filter((row) => relation(row, 'owner_user_id') === owner)
    .map((row) => {
      const start = stamp(attr(row, 'started_at'));
      const rawEnd = attr(row, 'closed_date');
      let end = stamp(rawEnd);
      if (start === null) unplaced.push(row.id);
      if (
        (rawEnd !== null && rawEnd !== undefined && end === null) ||
        (start !== null && end !== null && end < start)
      ) {
        evidenceGaps.push(`Run ${row.id} has an invalid end.`);
        end = null;
      }
      if (end === null)
        evidenceGaps.push(
          `Run ${row.id} has an unknown end; later-day overlap cannot be confirmed.`,
        );
      const ticketId = relation(row, 'ticket_id');
      if (!ticketId || !tickets[ticketId])
        evidenceGaps.push(`Run ${row.id} has unavailable ticket context.`);
      return {
        id: row.id,
        start,
        end,
        state: attr(row, 'state') ?? null,
        step: attr(row, 'state_at_start') ?? null,
        ticket_id: ticketId,
        conductor_id: relation(row, 'conductor_id'),
      };
    });
  if (unplaced.length)
    evidenceGaps.push(`Runs with unknown start: ${unplaced.join(', ')}.`);
  for (const row of runPage.data)
    if (!relation(row, 'owner_user_id'))
      evidenceGaps.push(`Run ${row.id} has unknown ownership.`);
  const runsComplete =
    runPage.complete &&
    unplaced.length === 0 &&
    runPage.data.every((row) => relation(row, 'owner_user_id'));
  const knownRuns = new Set([
    ...runs.map((run) => run.id),
    ...activityPage.included
      .filter(
        (row) =>
          row.type === 'bb_run--bb_run' &&
          relation(row, 'owner_user_id') === owner,
      )
      .map((row) => row.id),
  ]);
  for (const row of activityPage.data) {
    if (
      relation(row, 'actor') !== owner &&
      !knownRuns.has(relation(row, 'run_id') ?? '')
    )
      evidenceGaps.push(
        `Activity ${row.id} could not be attributed to this employee.`,
      );
  }
  const activities = activityPage.data
    .filter(
      (row) =>
        relation(row, 'actor') === owner ||
        knownRuns.has(relation(row, 'run_id') ?? ''),
    )
    .map((row) => {
      const time = stamp(attr(row, 'created'));
      const commentId = relation(row, 'comment_id');
      const summary = commentId ? summaries.get(commentId) : undefined;
      if (time === null)
        evidenceGaps.push(`Activity ${row.id} has an unknown timestamp.`);
      if (commentId && summary === undefined)
        evidenceGaps.push(`Activity ${row.id} has an unavailable summary.`);
      return {
        id: row.id,
        date: time === null ? null : dateAt(time),
        created: time === null ? null : iso(time),
        kind: attr(row, 'kind'),
        actor_id: relation(row, 'actor'),
        run_id: relation(row, 'run_id'),
        ticket_id: relation(row, 'ticket_id'),
        previous_state: attr(row, 'previous_state') ?? null,
        new_state: attr(row, 'new_state') ?? null,
        step: attr(row, 'step') ?? null,
        comment_id: commentId,
        summary: summary?.slice(0, 2000) ?? null,
        summary_truncated: (summary?.length ?? 0) > 2000,
      };
    });
  const worklogs = worklogPage.data.map((row) => ({
    id: row.id,
    date: row.work_date,
    state: row.state,
    duration_seconds: seconds(row.duration_seconds),
    description: row.description,
    ticket_id: row.ticket_id ?? null,
    project_id: row.project_id ?? null,
    submission_id: row.submission_id ?? null,
    source_keys: row.source_keys ?? null,
  }));
  const worklogsValid = worklogs.every(
    (row) =>
      typeof row.date === 'string' &&
      Number.isFinite(civilDate(row.date)) &&
      row.duration_seconds !== null &&
      ['recorded', 'approved', 'proposed'].includes(String(row.state)),
  );
  if (!worklogsValid)
    evidenceGaps.push('Some worklogs have invalid dates, states or durations.');
  for (const row of [...activities, ...worklogs]) {
    if (row.ticket_id && !tickets[row.ticket_id])
      evidenceGaps.push(`Resource ${row.id} has unavailable ticket context.`);
  }
  for (const row of worklogs)
    if (row.project_id && !projects[row.project_id])
      evidenceGaps.push(`Worklog ${row.id} has unavailable project context.`);
  const totals = (items: typeof worklogs) => ({
    recorded_seconds:
      worklogPage.complete && worklogsValid
        ? items
            .filter((w) => w.state === 'recorded' || w.state === 'approved')
            .reduce((sum, w) => sum + (w.duration_seconds ?? 0), 0)
        : null,
    proposed_seconds:
      worklogPage.complete && worklogsValid
        ? items
            .filter((w) => w.state === 'proposed')
            .reduce((sum, w) => sum + (w.duration_seconds ?? 0), 0)
        : null,
  });

  function daily(date: string) {
    const low = boundary(date),
      high = boundary(shiftDate(date, 1));
    const selected = runs.filter(
      (run) =>
        run.start !== null &&
        run.start < high &&
        (run.end === null ||
          run.end > low ||
          (run.end === run.start && run.start >= low)),
    );
    const uncertainOverlap = selected.some(
      (run) => run.end === null && (run.start as number) < low,
    );
    const intervals = selected
      .filter((r) => r.end !== null)
      .map((r) => ({
        start: Math.max(r.start as number, low),
        end: Math.min(r.end as number, high),
      }))
      .sort((a, b) => a.start - b.start);
    const merged: { start: number; end: number }[] = [];
    for (const interval of intervals) {
      const last = merged.at(-1);
      if (last && interval.start <= last.end)
        last.end = Math.max(last.end, interval.end);
      else merged.push({ ...interval });
    }
    const spanComplete =
      runsComplete && selected.every((run) => run.end !== null);
    const clusters = merged.map((r) => ({
      start: iso(r.start),
      end: iso(r.end),
    }));
    const gaps: { start: string; end: string; seconds: number }[] = [];
    if (spanComplete) {
      for (let i = 1; i < merged.length; i++) {
        const previous = merged[i - 1],
          current = merged[i];
        if (previous && current)
          gaps.push({
            start: iso(previous.end),
            end: iso(current.start),
            seconds: (current.start - previous.end) / 1000,
          });
      }
    }
    const last = merged.at(-1);
    const states: Record<string, number> = {};
    for (const run of selected)
      states[String(run.state)] = (states[String(run.state)] ?? 0) + 1;
    return {
      date,
      start: iso(low),
      end: iso(high),
      run_count: runsComplete && !uncertainOverlap ? selected.length : null,
      observed_run_count: selected.filter(
        (r) => r.end !== null || (r.start as number) >= low,
      ).length,
      span_complete: spanComplete,
      states,
      first_start: selected.length
        ? iso(
            Math.max(low, Math.min(...selected.map((r) => r.start as number))),
          )
        : null,
      last_end: last ? iso(last.end) : null,
      known_duration_seconds: merged.reduce(
        (sum, r) => sum + (r.end - r.start) / 1000,
        0,
      ),
      clusters,
      gaps,
      runs: selected.map((r) => ({
        ...r,
        start: iso(r.start as number),
        end: r.end === null ? null : iso(r.end),
        full_duration_seconds:
          r.end === null ? null : (r.end - (r.start as number)) / 1000,
      })),
    };
  }
  const days = dates.map((date) => {
    const day = daily(date);
    const baseline = [7, 14, 21, 28].map((delta) => {
      const previous = daily(shiftDate(date, -delta));
      return {
        date: previous.date,
        run_count: previous.run_count,
        known_duration_seconds: previous.known_duration_seconds,
        first_start: previous.first_start,
        last_end: previous.last_end,
        span_complete: previous.span_complete,
      };
    });
    const counts = baseline
      .map((b) => b.run_count)
      .filter((n): n is number => n !== null)
      .sort((a, b) => a - b);
    const middle = counts.slice(
      Math.floor((counts.length - 1) / 2),
      Math.floor(counts.length / 2) + 1,
    );
    const median = middle.length
      ? middle.reduce((sum, value) => sum + value, 0) / middle.length
      : null;
    return {
      ...day,
      baseline,
      baseline_median: median,
      baseline_samples: counts.length,
      schedule_seconds: seconds(schedule?.[`day_${weekday(date)}`]),
      cap_seconds: seconds(schedule?.cap),
      activities: activities.filter((a) => a.date === date),
      worklog_ids: worklogs.filter((w) => w.date === date).map((w) => w.id),
      ...totals(worklogs.filter((w) => w.date === date)),
    };
  });
  const weeks = [];
  for (let date = weekStart; date <= weekEnd; date = shiftDate(date, 7)) {
    const last = shiftDate(date, 6);
    const values = Array.from({ length: 7 }, (_, i) =>
      seconds(schedule?.[`day_${i}`]),
    );
    weeks.push({
      from: date,
      to: last,
      schedule_seconds: values.every((v) => v !== null)
        ? values.reduce<number>((sum, v) => sum + (v ?? 0), 0)
        : null,
      ...totals(
        worklogs.filter(
          (w) => typeof w.date === 'string' && w.date >= date && w.date <= last,
        ),
      ),
    });
  }
  return {
    owner_id: owner,
    timezone,
    from: selection.from,
    to: selection.to,
    complete: evidenceGaps.length === 0,
    evidence_gaps: [...new Set(evidenceGaps)],
    unplaced_run_ids: unplaced,
    days,
    weeks,
    worklogs,
    tickets,
    projects,
  };
}
