# CI e2e runner (merge gate only, never deployed): the Playwright suite and the conductor
# integration suite, run on the e2e stack's network against the gate's php/nginx/mcp images.
# The base image version matches @playwright/test in tests/playwright/package-lock.json.
FROM mcr.microsoft.com/playwright:v1.61.1-noble

COPY --from=docker:26-cli /usr/local/bin/docker /usr/local/bin/docker
COPY docker/e2e/drush /usr/local/bin/drush
ENV CI=true \
    PNPM_CONFIG_MINIMUM_RELEASE_AGE=0 \
    PNPM_CONFIG_DANGEROUSLY_ALLOW_ALL_BUILDS=true \
    # The integration helpers take `drush` from PATH only inside DDEV; the shim above is that drush.
    DDEV_PROJECT=e2e
RUN corepack enable pnpm

WORKDIR /repo
COPY tests/playwright/package.json tests/playwright/package-lock.json tests/playwright/
RUN cd tests/playwright && npm ci --no-audit --no-fund
COPY . .
RUN cd bakers-cli && pnpm install --frozen-lockfile && pnpm run build:all
