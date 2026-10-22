// The manual's shape, shared by config.mts and scripts/check-pages.mjs so the
// checks see exactly what the site renders and navigates.

// Markdown under docs/ the site does not render.
export const SRC_EXCLUDE = [
  'decisions/**',
  'bakers/**',
  'conductor/**',
  'bakers-metrics.md',
]

// The five areas: the top navigation and the sidebar's icon strip.
export const AREAS = [
  { label: 'Get started', link: '/get-started/', icon: 'guide' },
  { label: 'Daily work', link: '/daily-work/', icon: 'guide' },
  { label: 'Skills & Workflows', link: '/skills-and-workflows/', icon: 'guide' },
  { label: 'Addons', link: '/addons/', icon: 'reference' },
  { label: 'Advanced', link: '/advanced/', icon: 'contributing' },
]

const group = (text, items) => ({ text, items: items.map(([label, link]) => ({ text: label, link })) })

export const SIDEBAR = {
  '/manual': [group('Documentation', AREAS.map((area) => [area.label, area.link]))],
  '/get-started/': [
    group('Get started', [
      ['Overview', '/get-started/'],
      ['What is bakers.build', '/get-started/what-is-bakers'],
      ['Is bakers.build right for us?', '/get-started/is-bakers-right-for-us'],
      ['Set up bakers.build', '/get-started/install'],
      ['Connect your project', '/get-started/connect-a-project'],
      ['Run your first ticket', '/get-started/first-ticket'],
      ['Work in the browser', '/get-started/work-in-the-browser'],
    ]),
  ],
  '/daily-work/': [
    group('Daily work', [['Overview', '/daily-work/']]),
    group('Manage tickets', [
      ['Create a ticket', '/daily-work/create-a-ticket'],
      ['Follow a ticket', '/daily-work/follow-a-ticket'],
      ['Email notifications', '/daily-work/email-notifications'],
      ['Accept results', '/daily-work/accept-results'],
      ['Freeze a ticket', '/daily-work/freeze-a-ticket'],
      ['See what the team works on', '/daily-work/team-overview'],
    ]),
    group('More', [
      ['Record time', '/daily-work/record-time'],
      ['Work from claude.ai', '/daily-work/claude-ai'],
      ['Who sees what', '/daily-work/who-sees-what'],
    ]),
  ],
  '/skills-and-workflows/': [
    group('Skills & Workflows', [
      ['Overview', '/skills-and-workflows/'],
      ['How it works', '/skills-and-workflows/how-it-works'],
      ['Configure your workflow', '/skills-and-workflows/write-workflow-md'],
      ['Workflows and states', '/skills-and-workflows/workflows-and-states'],
      ['Labels and work types', '/skills-and-workflows/labels-and-work-types'],
    ]),
  ],
  '/addons/': [
    group('Addons', [
      ['Overview', '/addons/'],
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
    group('Execution and workspaces', [
      ['herdr', '/addons/herdr'],
      ['Git workspace', '/addons/workspace-git'],
      ['bakers.build server remote', '/addons/remote-drupal'],
    ]),
    group('Sharing previews and ports', [
      ['Ports', '/addons/ports'],
      ['Shared processes', '/addons/ports-services'],
      ['Named Cloudflare tunnel', '/addons/ports-cloudflare'],
      ['Cloudflare Quick tunnel', '/addons/ports-cloudflare-quick'],
      ['frp tunnel', '/addons/ports-frp'],
      ['DDEV discovery', '/addons/ddev'],
      ['Docker Compose discovery', '/addons/docker-compose'],
    ]),
    group('Terminal UI', [
      ['Terminal UI', '/addons/bakers-ui'],
      ['Artifacts', '/addons/bakers-ui-artifacts'],
    ]),
    group('Time', [
      ['Time evidence', '/addons/track'],
    ]),
    group('Commands', [
      ['Agent catalog', '/addons/agents'],
      ['Project info', '/addons/info'],
      ['Deployment tickets', '/addons/deployment'],
      ['dropsh shell', '/addons/dropsh'],
    ]),
    group('Connection support', [
      ['Essentials', '/addons/essentials'],
      ['Name references', '/addons/name-refs'],
      ['Ambient workspace', '/addons/workspace'],
      ['HTTP Basic sign-in', '/addons/auth-basic'],
    ]),
    group('Internal and test', [
      ['Fake conductor fixture', '/addons/fake'],
    ]),
    group('Build your own', [
      ['Addon contracts', '/addons/build/contracts'],
      ['Addon actions', '/addons/build/actions'],
    ]),
  ],
  '/advanced/': [
    group('Configuration', [
      ['Which file owns what', '/advanced/configuration/'],
      ['Hooks', '/advanced/configuration/hooks'],
      ['Agents and models', '/advanced/configuration/agents-and-models'],
      ['Update bakers.build', '/advanced/configuration/update'],
      ['claude.ai limits and errors', '/advanced/configuration/claude-connector-limits'],
      ['claude.ai project instructions', '/advanced/configuration/claude-project-instructions'],
      ['Origin labels', '/advanced/configuration/origin-labels'],
    ]),
    group('Operations', [
      ['Overview', '/advanced/'],
      ['Machines', '/advanced/machines'],
      ['Connections', '/advanced/connections'],
      ['Conductors', '/advanced/conductors'],
      ['Set up a worker server', '/advanced/worker-server'],
      ['Conductor configuration', '/advanced/conductor-config'],
      ['Server', '/advanced/server'],
      ['Configuration migration', '/advanced/migration'],
      ['Ticket metrics', '/advanced/ticket-metrics'],
      ['Deployment and verification workflows', '/advanced/deployment-and-verification'],
      ['Hosted or self-run', '/advanced/hosted-or-self-run'],
      ['Where your code and data live', '/advanced/where-your-data-lives'],
      ['API keys and service accounts', '/advanced/api-keys'],
    ]),
    group('CLI setup', [
      ['Install the CLI', '/advanced/cli/install'],
      ['Switch to the bakers CLI', '/advanced/cli/switch-to-bakers'],
      ['Prepare a machine', '/advanced/cli/prepare-machine'],
      ['Check machine tools', '/advanced/cli/check-machine-tools'],
      ['Set up herdr', '/advanced/cli/herdr'],
      ['Set up DDEV', '/advanced/cli/ddev'],
      ['Set up Node.js', '/advanced/cli/node'],
      ['Connect a project by hand', '/advanced/cli/connect-a-project'],
      ['Run tickets from the terminal', '/advanced/cli/first-ticket'],
      ['Terminal UI', '/advanced/cli/terminal-ui'],
      ['Tickets in the terminal', '/advanced/cli/tickets-in-the-terminal'],
      ['Troubleshooting', '/advanced/cli/troubleshooting'],
    ]),
    group('CLI reference', [
      ['Commands', '/advanced/cli/'],
      ['bakers oven', '/advanced/cli/conductor'],
      ['bakers ui', '/advanced/cli/ui'],
      ['bakers ui keys', '/advanced/cli/ui-keys'],
      ['bakers dropsh', '/advanced/cli/dropsh'],
      ['bakers deployment', '/advanced/cli/deployment'],
    ]),
    group('Development', [
      ['Overview', '/advanced/development/'],
      ['Build from source', '/advanced/development/build-from-source'],
      ['Skill contract', '/advanced/development/skill-contract'],
      ['Write a step skill', '/advanced/development/write-a-step-skill'],
      ['Test a skill', '/advanced/development/test-skills'],
      ['Test skill tool calls', '/advanced/development/test-skill-tools'],
      ['Add a skill test', '/advanced/development/add-skill-test'],
      ['Test run-outtake', '/advanced/development/test-run-outtake'],
      ['Architecture', '/advanced/development/architecture'],
      ['Islands and profiles', '/advanced/development/islands-and-profiles'],
      ['Write the docs', '/advanced/development/write-docs'],
    ]),
  ],
}
