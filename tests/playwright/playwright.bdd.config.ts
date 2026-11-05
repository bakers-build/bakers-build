import { defineConfig, devices } from '@playwright/test';
import { defineBddConfig } from 'playwright-bdd';
import { resolveBaseURL } from './resolve-base-url';

// TWO generated suites, split by the `@nojs` tag, because "works with
// JavaScript disabled" is a BROWSER CONTEXT option and not something a step can
// turn on: `javaScriptEnabled` is fixed when the context is created, so it can
// only be expressed as a second Playwright project. Everything else about the
// two projects is identical, and the tag expressions are complements — so every
// scenario in `features/` runs exactly once, in exactly one of them.
const testDir = defineBddConfig({
    features: './features/**/*.feature',
    steps: ['./steps/**/*.ts', './support/steps/**/*.ts'],
    importTestFrom: './bdd.fixtures.ts', // BDD test (merged) + project fixtures
    outputDir: '.features-gen/js',
    tags: 'not @nojs',
});

const noJsTestDir = defineBddConfig({
    features: './features/**/*.feature',
    steps: ['./steps/**/*.ts', './support/steps/**/*.ts'],
    importTestFrom: './bdd.fixtures.ts',
    outputDir: '.features-gen/nojs',
    tags: '@nojs',
});

export default defineConfig({
    timeout: 60000,
    // Four workers, each with its own Drupal session (support/worker-auth-provider.ts).
    // What used to force serial execution was the session CACHE, not the account: every
    // worker replayed one cached cookie, so Drupal's session-stored status messages
    // interleaved. One `uli` per (worker, account) pair costs about eight logins for the
    // whole run and removes the shared row.
    workers: 4,
    // A FEATURE FILE is the unit of parallelism, not a scenario: playwright-bdd generates
    // one spec file per feature, and `fullyParallel: false` keeps a file's scenarios in
    // order on one worker. The suite relies on that order in places a reader cannot see
    // from a single scenario — Backgrounds, `@feature:*` After hooks, addresses reused
    // across the scenarios of one file.
    fullyParallel: false,
    // Fail immediately locally; CI explicitly allows one retry per failed test.
    retries: 0,
    reporter: [
        ['list'],
        ['junit', { outputFile: 'junit-playwright.xml' }],
        ['html', { outputFolder: 'playwright-report', open: 'never' }],
        ['json', { outputFile: 'bdd-results.json' }],
    ],
    use: {
        // Worktree-dependent DDEV URL, resolved per worktree from the addon's
        // git-ignored `.env.ddev` (never hardcoded); an explicit
        // PLAYWRIGHT_BASE_URL env var (CI/ad-hoc) overrides. See resolve-base-url.ts.
        baseURL: resolveBaseURL(),
        // Preserve each failed attempt, including one followed by a passing retry.
        trace: 'retain-on-failure',
        ignoreHTTPSErrors: true,
        // Route Chromium's shared memory to /tmp instead of /dev/shm. The suite
        // runs in containers (DDEV's web container, CI's e2e runner) whose
        // /dev/shm is Docker's 64MB default; under that ceiling the renderer intermittently dies with
        // "Target crashed" / "Page crashed" — not an assertion, a killed
        // process — which surfaced as flaky e2e failures scattered across
        // unrelated features. Disk-backed shm removes the ceiling. Applied in
        // global `use` so both chromium projects inherit it (neither overrides
        // launchOptions via devices['Desktop Chrome']).
        launchOptions: { args: ['--disable-dev-shm-usage'] },
    },
    projects: [
        { name: 'chromium', testDir, use: { ...devices['Desktop Chrome'] } },
        // AC 7's "works with JS off". The ULI login this suite uses is a plain
        // GET, so authentication still works here; what does not survive is any
        // scripted control — which is exactly the property the @nojs scenario
        // is there to hold.
        {
            name: 'chromium-nojs',
            testDir: noJsTestDir,
            use: { ...devices['Desktop Chrome'], javaScriptEnabled: false },
        },
    ],
});
