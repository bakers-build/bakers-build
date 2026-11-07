// The manual's shape, shared by config.mts and scripts/check-pages.mjs so the
// checks see exactly what the site renders and navigates.

// Markdown under docs/ the site does not render.
export const SRC_EXCLUDE = [
  'decisions/**',
  'bakers/**',
  'conductor/**',
  'bakers-metrics.md',
  // The site's own dependencies live beside the pages.
  'node_modules/**',
]

// Shared by desktop/mobile navigation and the sidebar area controls.
export const AREAS = [
  { label: 'Getting Started', link: '/get-started/', icon: 'guide' },
  { label: 'Configuration', link: '/configuration/', icon: 'contributing' },
  { label: 'Addons', link: '/addons/', icon: 'reference' },
]

const group = (text, items) => ({ text, items: items.map(([text, link]) => ({ text, link })) })

export const SIDEBAR = {
  '/manual': [group('Documentation', AREAS.map((area) => [area.label, area.link]))],
  '/get-started/': [
    group('Getting Started', [
      ['Overview', '/get-started/'],
      ['Set up a connector', '/get-started/connector'],
      ['Set up a machine', '/get-started/machine'],
      ['Set up a project', '/get-started/connect-a-project'],
      ['Run the first ticket', '/get-started/first-ticket'],
    ]),
    group('Daily work', [
      ['Accept results', '/get-started/daily-work/accept-results'],
      ['Create a ticket', '/get-started/daily-work/create-a-ticket'],
      ['Follow a ticket', '/get-started/daily-work/follow-a-ticket'],
      ['Freeze a ticket', '/get-started/daily-work/freeze-a-ticket'],
      ['Record time', '/get-started/daily-work/record-time'],
      ['See what the team works on', '/get-started/daily-work/team-overview'],
    ]),
  ],
  '/configuration/': [
    group('Connector', [
      ['Configuration overview', '/configuration/'],
      ['Connector', '/configuration/connector'],
      ['Connections', '/configuration/connector/connections'],
      ['Claude.ai connector limits and errors', '/configuration/connector/limits'],
      ['Get emails about ticket activity', '/configuration/connector/notifications'],
      ['Claude Project instructions (connector bundle)', '/configuration/connector/project-instructions'],
    ]),
    group('Machine', [
      ['Machine', '/configuration/machine'],
      ['Set up a Coder workspace', '/configuration/machine/coder-workspace'],
      ['Update bakers.build', '/configuration/machine/updates'],
      ['Set up a worker server', '/configuration/machine/worker-server'],
    ]),
    group('Project', [
      ['Project', '/configuration/project'],
      ['Conductors', '/configuration/project/conductors'],
      ['Conductor commands', '/configuration/project/conductor-commands'],
      ['Contributing to bakers.build', '/configuration/project/contributing'],
      ['Configuration migration', '/configuration/project/migration'],
      ['Server', '/configuration/project/server'],
      ['Komodo server', '/configuration/project/server-komodo'],
    ]),
    group('Provisioning', [
      ['Provisioning', '/configuration/provisioning'],
      ['Set up DDEV', '/configuration/provisioning/ddev'],
      ['Docker Compose', '/configuration/provisioning/docker-compose'],
      ['Add lifecycle hooks', '/configuration/provisioning/hooks'],
      ['Set up Node.js', '/configuration/provisioning/node'],
    ]),
    group('Clients', [
      ['Clients', '/configuration/clients'],
      ['CLI commands', '/configuration/clients/cli'],
      ['bakers tools', '/configuration/clients/tools'],
      ['bakers auth', '/configuration/clients/auth'],
      ['Switch to the bakers CLI', '/configuration/clients/switch-to-bakers'],
      ['Troubleshooting', '/configuration/clients/troubleshooting'],
    ]),
    group('Agents', [
      ['Agents', '/configuration/agents'],
      ['Install the bakers skills', '/configuration/agents/skills'],
      ['Run security', '/configuration/agents/execution-security'],
      ['Shared run security', '/configuration/agents/shared-security'],
      ['Agent policy reference', '/configuration/agents/reference'],
    ]),
    group('Workflows', [
      ['Workflows', '/configuration/workflows'],
      ['Ticket metrics', '/configuration/workflows/metrics'],
      ['Write a recipe', '/configuration/workflows/recipes'],
      ['Workflows and states', '/configuration/workflows/states'],
      ['Ticket type, recipe and labels', '/configuration/workflows/types-recipes-labels'],
      ['Configure your workflow', '/configuration/workflows/workflow-file'],
    ]),
    group('Security', [
      ['Security', '/configuration/security'],
      ['API keys and service accounts', '/configuration/security/credentials'],
    ]),
  ],
  '/addons/': [
    group('Addons', [
      ['Addons', '/addons/'],
      ['Configure addons', '/addons/configure'],
    ]),
    group('Agents', [
      ['Claude', '/addons/claude'],
      ['Codex', '/addons/codex'],
      ['Grok', '/addons/grok'],
      ['Kimi', '/addons/kimi'],
      ['OpenCode', '/addons/opencode'],
      ['Pi', '/addons/pi'],
    ]),
    group('Clients and workspaces', [
      ['herdr', '/addons/herdr'],
      ['herdr options', '/addons/herdr/options'],
      ['Orca', '/addons/orca'],
      ['Orca options', '/addons/orca/options'],
      ['Git workspace', '/addons/workspace-git'],
      ['Conductor slots', '/addons/slots'],
      ['bakers.build server remote', '/addons/remote-drupal'],
    ]),
    group('Provisioning support (port discovery)', [
      ['DDEV discovery', '/addons/ddev'],
      ['Docker Compose discovery', '/addons/docker-compose'],
    ]),
    group('Ports and previews', [
      ['Ports', '/addons/ports'],
      ['Shared processes', '/addons/ports-services'],
      ['Named Cloudflare tunnel', '/addons/ports-cloudflare'],
      ['Cloudflare Quick tunnel', '/addons/ports-cloudflare-quick'],
      ['frp tunnel', '/addons/ports-frp'],
    ]),
    group('Terminal UI', [
      ['Terminal UI', '/addons/bakers-ui'],
      ['bakers ui', '/addons/bakers-ui/reference'],
      ['Add a screen as a tab', '/addons/bakers-ui/tabs'],
      ['Tickets in the terminal', '/addons/bakers-ui/tickets'],
      ['Use the terminal UI', '/addons/bakers-ui/usage'],
      ['bakers ui keys', '/addons/bakers-ui-keys'],
      ['Artifacts', '/addons/bakers-ui-artifacts'],
    ]),
    group('Commands and time', [
      ['Agent catalog', '/addons/agents'],
      ['Project info', '/addons/info'],
      ['Deployment tickets', '/addons/deployment'],
      ['bakers deployment', '/addons/deployment/reference'],
      ['Time evidence', '/addons/track'],
    ]),
    group('Connection support', [
      ['Essentials', '/addons/essentials'],
      ['Name references', '/addons/name-refs'],
      ['Ambient workspace', '/addons/workspace'],
      ['HTTP Basic sign-in', '/addons/auth-basic'],
    ]),
    group('Internal test fixture', [
      ['Fake conductor fixture', '/addons/fake'],
    ]),
    group('Build your own', [
      ['Addon contracts', '/addons/build/contracts'],
      ['Write an addon with inbox messages', '/addons/build/actions'],
      ['Write an addon with agent tools', '/addons/build/tools'],
    ]),
  ],
}
