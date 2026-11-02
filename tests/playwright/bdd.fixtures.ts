import { test as bddBase, createBdd } from 'playwright-bdd';

import { ApiClient } from './support/api-client';
import { WorkerAuthProvider } from './support/worker-auth-provider';

export const test = bddBase.extend<{ authProvider: WorkerAuthProvider; apiClient: ApiClient }>({
    // One Drupal session per WORKER instead of per uid (support/worker-auth-provider.ts):
    // this is what lets several workers run at once without interleaving each other's
    // server-side status messages. `testInfo.workerIndex` gives each worker its own identity.
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

export const { Given, When, Then } = createBdd(test);
