/** Environment variables renamed from `BB_*` to `BAKERS_*` (BAKERS-159). */
export const RETIRED_ENV_NAMES = [
  'HOME',
  'CONFIG',
  'CONNECTION',
  'CONDUCTOR',
  'CONDUCTOR_CONFIG',
  'CONDUCTOR_LOG',
  'CONDUCTOR_TOKEN',
  'CONDUCTOR_URL',
  'TUNNEL',
  'LOG_LEVEL',
  'ID',
  'PROJECT',
  'PROJECT_ID',
  'WORKSPACE',
  'WORKSPACE_ID',
  'WORKSPACE_IDS',
  'RUN_UUID',
  'TICKET_UUID',
  'TICKET_IDENTIFIER',
  'STATE',
  'AGENT_SHELL',
  'COMMANDS',
  'UI_NO_BUN',
  'CONSUMER_SECRET',
  'CLIENT_ID',
  'CLIENT_SECRET',
] as const;

/** One error per retired `BB_*` variable set in `env`, naming its replacement. */
export function retiredEnvErrors(
  env: Record<string, string | undefined>,
): string[] {
  return RETIRED_ENV_NAMES.filter(
    (name) => env[`BB_${name}`] !== undefined,
  ).map((name) => `BB_${name} was renamed: set BAKERS_${name} instead`);
}
