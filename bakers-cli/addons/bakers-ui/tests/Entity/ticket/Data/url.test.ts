import { describe, expect, it } from 'vitest';
import { ticketUrl } from '../../../../src/Entity/ticket/Data/url.js';

// BB-326 — the address the operator taps on their phone.
//
// `/admin/bakers/ticket/{bb_ticket}` is the entity's canonical link template
// (`web/modules/custom/bb_core/src/Entity/BbTicket.php`), and it accepts a
// UUID because `BbEntityUuidConverter` is attached to that route. That matters
// here: the only id this renderer has is JSON:API's resource id, which IS the
// uuid — there is no integer entity id anywhere in the TUI.

describe('ticketUrl', () => {
  it('is the ticket’s canonical page on the connected control plane', () => {
    expect(
      ticketUrl(
        'https://bakers.example.test',
        '0a1b2c3d-4e5f-6071-8293-a4b5c6d7e8f9',
      ),
    ).toBe(
      'https://bakers.example.test/admin/bakers/ticket/0a1b2c3d-4e5f-6071-8293-a4b5c6d7e8f9',
    );
  });

  it('does not double the slash when the base URL carries one', () => {
    expect(ticketUrl('https://bakers.example.test/', 'abc')).toBe(
      'https://bakers.example.test/admin/bakers/ticket/abc',
    );
  });

  it('keeps a base URL that lives under a path prefix', () => {
    expect(ticketUrl('https://example.test/bakers', 'abc')).toBe(
      'https://example.test/bakers/admin/bakers/ticket/abc',
    );
  });

  it('is undefined without a base URL — there is no link to offer, and inventing one would be worse', () => {
    expect(ticketUrl(undefined, 'abc')).toBeUndefined();
    expect(ticketUrl('', 'abc')).toBeUndefined();
  });

  it('is undefined without a ticket id', () => {
    expect(ticketUrl('https://example.test', undefined)).toBeUndefined();
    expect(ticketUrl('https://example.test', '')).toBeUndefined();
  });
});
