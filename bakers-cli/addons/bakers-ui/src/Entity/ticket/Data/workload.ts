export interface WorkloadTicket {
  id: string;
  closed: boolean;
  derivedStatus: string;
  assigneeId?: string | null;
}

export interface Workload<T extends WorkloadTicket> {
  open: T[];
  running: T[];
  waiting: T[];
  unassigned: T[];
}

export function classifyWorkload<T extends WorkloadTicket>(
  rows: readonly T[],
): Workload<T> {
  const open = rows.filter((row) => !row.closed);

  return {
    open,
    running: open.filter((row) => row.derivedStatus === 'running'),
    waiting: open.filter((row) => row.derivedStatus !== 'running'),
    unassigned: open.filter((row) => !row.assigneeId),
  };
}
