// The ticket's addons as the server reads them for a viewer
// (`GET bakers/addons/ticket/{uuid}`), and the one write: sending a message
// through the conductor inbox (`POST bakers/inbox/send`). The TUI renders the
// same definitions and states as the web card, so a reviewer's `bakers ui`
// needs no addon installed. Contract 1 (views/actions/rows, BB-661) is
// retired; only contract-2 messages are live.

import type { MessageInput, MessageResult } from '@bakers-build/message';
import type { DropshClient } from '../../../types.js';

export interface AddonLatest {
  status: string;
  result: MessageResult | null;
  changed: number;
}

/** A contract-2 message entry (BB-661). */
export interface AddonMessageEntry {
  key: string;
  label: string;
  input: MessageInput | null;
  access: string;
  /** Whether the viewer holds the ticket operation the message requires. */
  access_ok: boolean;
}

export interface TicketAddon {
  id: string;
  name: string;
  version: string;
  contract: number;
  label: string;
  messages: AddonMessageEntry[];
  /**
   * This requester's own newest message for the ticket (BB-661), never
   * another requester's — the server already selects it.
   */
  latest: (AddonLatest & { action: string; label: string }) | null;
}

export interface TicketAddons {
  conductor: { status: string } | null;
  addons: TicketAddon[];
}

/** One selectable line of an addon panel. */
export type AddonEntry = {
  kind: 'message';
  id: string;
  message: AddonMessageEntry;
};

export async function readTicketAddons(
  client: Pick<DropshClient, 'get'>,
  ticketUuid: string,
): Promise<TicketAddons> {
  const doc = (await client.get(`bakers/addons/ticket/${ticketUuid}`)) as {
    data?: { attributes?: Partial<TicketAddons> };
  };
  const attrs = doc?.data?.attributes;
  return { conductor: attrs?.conductor ?? null, addons: attrs?.addons ?? [] };
}

export async function sendAddonAction(
  client: Pick<DropshClient, 'post'>,
  ticketUuid: string,
  messageId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await client.post('bakers/inbox/send', {
    data: {
      attributes: { ticket: ticketUuid, message_id: messageId, payload },
    },
  });
}

/**
 * Whether the addon's newest message is still pending or running. Messages
 * are answered in order, so no older one can still be open.
 */
export function isOpen(addon: TicketAddon): boolean {
  return (
    addon.latest?.status === 'pending' || addon.latest?.status === 'running'
  );
}

/** The panel's lines: one entry per permitted message, always. */
export function addonEntries(addon: TicketAddon): AddonEntry[] {
  return addon.messages
    .filter((message) => message.access_ok)
    .map((message) => ({
      kind: 'message' as const,
      id: `message:${message.key}`,
      message,
    }));
}
