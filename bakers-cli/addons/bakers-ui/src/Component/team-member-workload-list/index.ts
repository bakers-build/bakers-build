import type { SectionLine } from '../section-list/index.js';

export interface TeamMemberWorkloadListItem {
  userId: string;
  label: string;
  open: number;
  running: number;
  waiting: number;
}

const countCell = (text: string) => ({
  text,
  width: 9,
  right: true as const,
});

export function teamMemberWorkloadRows(
  members: readonly TeamMemberWorkloadListItem[],
): SectionLine[] {
  const memberCell = (text: string) => ({
    text,
    width: 24,
    min: 12,
    grow: 1,
  });

  return [
    {
      cells: [
        memberCell('Member'),
        countCell('Open'),
        countCell('Running'),
        countCell('Waiting'),
      ],
    },
    ...members.map((member) => ({
      cells: [
        memberCell(member.label),
        countCell(String(member.open)),
        countCell(String(member.running)),
        countCell(String(member.waiting)),
      ],
    })),
  ];
}
