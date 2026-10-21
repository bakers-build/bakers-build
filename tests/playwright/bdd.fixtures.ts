// playwright-bdd's createBdd() requires a `test` that carries the BDD context
// AND the keytec core fixtures (page, authProvider, entityForm, …). The core
// package exports that merged `test` from `@key-tec/playwright-core/bdd`;
// project BDD fixtures MUST build on top of it (not on core/fixtures), else
// generation fails with "createBdd() should use 'test' extended from playwright-bdd".
import { test as bddBase } from '@key-tec/playwright-core/bdd';

import { ApiClient } from './support/api-client';
import { WorkerAuthProvider } from './support/worker-auth-provider';

export const test = bddBase.extend<{ apiClient: ApiClient }>({
    // One Drupal session per WORKER instead of per uid (support/worker-auth-provider.ts):
    // this is what lets several workers run at once without interleaving each other's
    // server-side status messages. Stays test-scoped because the core fixture it overrides
    // is; `testInfo.workerIndex` still gives each worker its own identity.
    authProvider: async ({}, use, testInfo) => {
        await use(new WorkerAuthProvider(testInfo.project.outputDir, testInfo.workerIndex));
    },
    apiClient: async ({ playwright, baseURL }, use) => {
        if (!baseURL) throw new Error('API scenarios require the configured test base URL.');
        const client = new ApiClient(playwright, baseURL);
        try {
            await use(client);
        } finally {
            await client.dispose();
        }
    },
});
export { expect } from '@playwright/test';
