/**
 * Integration test: TUI (bakers-cli) cross-tenant read isolation, BB-315 AC2.
 *
 * A review of BB-315 found isolation ("a user of workspace A can reach no
 * ticket/project/run/statistic/person of workspace B") covered on 3 of 4
 * required surfaces — JSON:API (Playwright), the statistics resource
 * (Playwright + Kernel), and the Dashboard (Playwright) — but NOT through
 * bakers-cli's own request path. `@bakers-build/addon-workspace` DOES add client-side
 * read filtering — `WORKSPACE_READ_SCOPE_PATHS` narrows a collection search to
 * the configured workspace — but BB-495 confined that filter (and the
 * create-time fill) to `bakers ui`, which attaches the addon to its own
 * connection; the dropsh path this suite exercises carries none of it. Either
 * way, cross-tenant isolation itself is entirely a SERVER-side property
 * (`BbWorkspaceReadScope`, `query_access` / `BbStatistics`) — the client-side filter only narrows
 * `bakers ui`'s own view among what the server already permits. A client-side
 * unit test with mocked HTTP would prove nothing about the server rule this
 * suite exists for. This suite therefore drives the real backend through
 * dropsh's own JSON:API client
 * (auth adapter, retries, response parsing) exactly as `bakers dropsh` does,
 * with two different seeded identities, and asserts the server denies or
 * excludes the other tenant's rows.
 *
 * Fixture contract (seeded by the `bb_e2e` recipe — see
 * `recipes/bb_e2e/content/bb_workspace/*.yml`, mirrored at
 * `tests/playwright/support/contract-world.json`, the same world
 * `tests/playwright/features/workspace/workspace.feature` and
 * `rank-access.feature` already use for JSON:API-level coverage):
 *
 *   north-contributor  — member of ONLY "workspace.home" / "project.home".
 *   south-contributor — member of ONLY "workspace.other" / "project.other".
 *
 * Both accounts and their fixed recipe-test password (`Bb-test-login-426!`)
 * are public, recipe-test-only credentials already committed in clear text by
 * `tests/playwright/support/api-client.ts` and the recipe content itself
 * (`recipes/bb_e2e/content/user/*.yml`, `pre_hashed: false`).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { HttpError } from 'dropsh/plugin';
import { beforeAll, describe, expect, it } from 'vitest';
import { createContextForAccount, type E2EContext } from './helpers.js';

/** Fixed recipe-test password for the seeded test accounts (never a real one). */
const RECIPE_TEST_PASSWORD = 'Bb-test-login-426!';

/**
 * The Playwright suite's own fixture registry — read directly rather than
 * duplicated, so this suite cannot silently drift from the world Playwright's
 * API-level coverage already asserts against.
 */
const WORLD = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL(
        '../../../../tests/playwright/support/contract-world.json',
        import.meta.url,
      ),
    ),
    'utf8',
  ),
) as Record<string, { uuid: string; entityType: string }>;

function fixture(name: string): string {
  const entry = WORLD[name];
  if (!entry) throw new Error(`Unknown contract fixture: ${name}`);
  return entry.uuid;
}

describe('TUI cross-tenant read isolation (BB-315 AC2)', () => {
  let home: E2EContext; // authenticated as north-contributor (workspace.home only)
  let other: E2EContext; // authenticated as south-contributor (workspace.other only)

  const ticketHome = fixture('ticket.home');
  const ticketOther = fixture('ticket.other');
  const projectHome = fixture('project.home');
  const projectOther = fixture('project.other');
  const userMember = fixture('user.member');
  const userForeign = fixture('user.foreign');

  beforeAll(async () => {
    home = await createContextForAccount(
      'north-contributor',
      RECIPE_TEST_PASSWORD,
    );
    other = await createContextForAccount(
      'south-contributor',
      RECIPE_TEST_PASSWORD,
    );
  });

  describe('bb_ticket', () => {
    it('a search scoped to the OTHER workspace excludes it and includes its own', async () => {
      const homeIds = (await home.api.collection('bb_ticket').list()).map(
        (r) => r.id,
      );
      expect(homeIds).toContain(ticketHome);
      expect(homeIds).not.toContain(ticketOther);

      const otherIds = (await other.api.collection('bb_ticket').list()).map(
        (r) => r.id,
      );
      expect(otherIds).toContain(ticketOther);
      expect(otherIds).not.toContain(ticketHome);
    });

    it('an individual read of the OTHER workspace ticket is denied, not served', async () => {
      const err = await home.api.resource('bb_ticket', ticketOther).then(
        () => null,
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(HttpError);
      expect((err as HttpError).status).toBe(403);

      // Own-workspace read of the same shape still works — proves the denial
      // above is tenancy-scoped, not a broken read path.
      const own = await home.api.resource('bb_ticket', ticketHome);
      expect(own.id).toBe(ticketHome);
    });
  });

  describe('bb_project', () => {
    it('a search excludes the OTHER workspace project and includes its own', async () => {
      const homeIds = (await home.api.collection('bb_project').list()).map(
        (r) => r.id,
      );
      expect(homeIds).toContain(projectHome);
      expect(homeIds).not.toContain(projectOther);

      const otherIds = (await other.api.collection('bb_project').list()).map(
        (r) => r.id,
      );
      expect(otherIds).toContain(projectOther);
      expect(otherIds).not.toContain(projectHome);
    });
  });

  describe('bb_run', () => {
    it('a search filtered onto the OTHER workspace ticket returns nothing', async () => {
      const foundFromHome = await home.api
        .collection('bb_run')
        .where('ticket_id.id', '=', ticketOther)
        .first();
      expect(foundFromHome).toBeNull();

      const foundFromOther = await other.api
        .collection('bb_run')
        .where('ticket_id.id', '=', ticketHome)
        .first();
      expect(foundFromOther).toBeNull();

      // Control: each member's OWN run is still reachable through the same
      // filtered search. (Several pagination-fixture runs share ticket.home /
      // ticket.other, so only the ticket relation — not a specific run id —
      // is asserted.)
      const ownFromHome = await home.api
        .collection('bb_run')
        .where('ticket_id.id', '=', ticketHome)
        .first();
      expect(ownFromHome?.rel('ticket_id')).toBe(ticketHome);

      const ownFromOther = await other.api
        .collection('bb_run')
        .where('ticket_id.id', '=', ticketOther)
        .first();
      expect(ownFromOther?.rel('ticket_id')).toBe(ticketOther);
    });
  });

  describe('bakers/statistics', () => {
    // Composite discovery takes the named `?project_id=<uuid>` context and
    // discloses a figure only inside the group permission grants it in.
    // `north-contributor` holds no membership of any kind on `project.other`,
    // so the request still succeeds — a bare uuid is not itself privileged
    // information, and the item route's own FigureAccess already treats
    // "does not resolve" and "resolves but forbidden" identically for that
    // reason — but every figure scoped to `bb_project` is omitted, exactly
    // as it is for a caller with no rank on their OWN project (statistics
    // .feature "A plain project member sees none of the project's figures").
    // What this test adds beyond that one: the omission holds across a
    // workspace boundary too, not only within one.
    it('scoping the statistics discovery to a foreign project discloses no figures', async () => {
      const doc = (await home.api.get(
        `bakers/statistics?project_id=${projectOther}`,
      )) as { data: { attributes: { groups: unknown[] } } };
      expect(doc.data.attributes.groups).toEqual([]);
    });
  });

  describe('user (person)', () => {
    it('the people collection lists local members without leaking foreign ones', async () => {
      const ids = (await home.api.collection('user').list()).map((r) => r.id);
      expect(ids).toContain(userMember);
      expect(ids).not.toContain(userForeign);
    });
  });
});
