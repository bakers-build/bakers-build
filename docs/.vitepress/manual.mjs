// Shared navigation and rendered-page exclusions for VitePress and its checks.
export const SRC_EXCLUDE = ["decisions/**", "bakers/**", "conductor/**", "bakers-metrics.md", "node_modules/**"]

export const AREAS = [
  { label: "Get started", link: "/get-started/", icon: "guide" },
  { label: "Provision", link: "/provision/", icon: "contributing" },
  { label: "Agents", link: "/agents/", icon: "guide" },
  { label: "Skills & Workflows", link: "/skills-and-workflows/", icon: "guide" },
  { label: "Addons", link: "/addons/", icon: "reference" },
  { label: "Configuration", link: "/configuration/", icon: "contributing" },
  { label: "Self-hosting", link: "/self-hosting/", icon: "contributing" },
  { label: "Development", link: "/development/", icon: "contributing" },
]

export const NAV = [
  { text: "How it works", link: "/#how-it-works" },
  { text: "Get started", link: "/get-started/" },
  {
    text: "Documentation",
    items: AREAS
      .filter(({ link }) => link !== "/get-started/" && link !== "/addons/")
      .map(({ label, link }) => ({ text: label, link })),
  },
  { text: "Addons", link: "/addons/" },
]

const group = (text, items) => ({ text, items: items.map(([text, link]) => ({ text, link })) })

export const SIDEBAR = {
  "/manual": [group("Documentation", AREAS.map(({ label, link }) => [label, link]))],
  "/get-started/": [
    group("Start here", [
      ["Overview", "/get-started/"],
      ["Use your client", "/get-started/use-your-client"],
      ["Prepare your project", "/get-started/connect-a-project"],
      ["Run the first ticket", "/get-started/first-ticket"],
    ]),
    group("Daily work", [
      ["Create a ticket", "/get-started/daily-work/create-a-ticket"],
      ["Follow a ticket", "/get-started/daily-work/follow-a-ticket"],
      ["Review and accept results", "/skills-and-workflows/accept-results"],
      ["Freeze a ticket", "/get-started/daily-work/freeze-a-ticket"],
      ["Record time", "/get-started/daily-work/record-time"],
      ["See what the team works on", "/get-started/daily-work/team-overview"],
    ]),
    group("Chat access", [
      ["Connect your chat", "/get-started/connector"],
    ]),
  ],
  "/provision/": [
    group("Setup path", [
      ["Overview", "/provision/"],
      ["Choose where agents run", "/provision/machine"],
      ["Prepare your project", "/get-started/connect-a-project"],
      ["Run the first ticket", "/get-started/first-ticket"],
    ]),
    group("Tools and access", [
      ["Tools and integrations", "/provision/tools"],
      ["Run agents securely", "/provision/security/"],
    ]),
    group("Machine setup", [
      ["Set up a Coder workspace", "/provision/coder-workspace"],
      ["Set up a worker server", "/provision/worker-server"],
      ["Install Node.js", "/provision/node"],
    ]),
    group("Project environment", [
      ["Prepare a worktree environment", "/provision/guide"],
      ["Choose an example", "/provision/examples"],
      ["DDEV", "/addons/ddev/setup"],
      ["Docker Compose", "/provision/docker-compose"],
      ["Node.js application", "/provision/node-project"],
    ]),
    group("Lifecycle", [
      ["Add lifecycle hooks", "/provision/hooks"],
    ]),
    group("Security", [
      ["Execution limits", "/provision/security/execution"],
      ["Machine and project policy", "/provision/security/shared-settings"],
      ["Access and data", "/provision/security/access-and-data"],
      ["API keys and service accounts", "/provision/security/credentials"],
    ]),
  ],
  "/agents/": [
    group("Agents", [
      ["Overview", "/agents/"],
      ["Choose agents and models", "/agents/guide"],
      ["Agent policy reference", "/agents/reference"],
    ]),
  ],
  "/skills-and-workflows/": [
    group("Skills & Workflows", [
      ["Overview", "/skills-and-workflows/"],
      ["Accept results", "/skills-and-workflows/accept-results"],
      ["Install the bakers skills", "/skills-and-workflows/skills"],
      ["Workflows", "/skills-and-workflows/guide"],
      ["Ticket metrics", "/skills-and-workflows/metrics"],
      ["Write a recipe", "/skills-and-workflows/recipes"],
      ["Workflows and states", "/skills-and-workflows/states"],
      ["Ticket type, recipe and labels", "/skills-and-workflows/types-recipes-labels"],
      ["Configure your workflow", "/skills-and-workflows/workflow-file"],
    ]),
  ],
  "/addons/": [
    group("Catalog", [
      ["Supported addons", "/addons/catalog"],
    ]),
    group("Addons", [
      ["Overview", "/addons/"],
      ["Configure addons", "/addons/configure"],
    ]),
    group("Agents", [
      ["Claude", "/addons/claude"],
      ["Codex", "/addons/codex"],
      ["Grok", "/addons/grok"],
      ["Kimi", "/addons/kimi"],
      ["OpenCode", "/addons/opencode"],
      ["Pi", "/addons/pi"],
    ]),
    group("Clients and workspaces", [
      ["herdr", "/addons/herdr"],
      ["herdr options", "/addons/herdr/options"],
      ["herdr-core", "/addons/herdr-core"],
      ["herdr-core options", "/addons/herdr-core/options"],
      ["Orca", "/addons/orca"],
      ["Orca options", "/addons/orca/options"],
      ["Git workspace", "/addons/workspace-git"],
      ["Conductor slots", "/addons/slots"],
      ["bakers.build server remote", "/addons/remote-drupal"],
    ]),
    group("Runtimes", [
      ["DDEV", "/addons/ddev"],
      ["Set up DDEV", "/addons/ddev/setup"],
      ["Docker Compose discovery", "/addons/docker-compose"],
    ]),
    group("Ports and previews", [
      ["Ports", "/addons/ports"],
      ["Shared processes", "/addons/ports-services"],
      ["Named Cloudflare tunnel", "/addons/ports-cloudflare"],
      ["Cloudflare Quick tunnel", "/addons/ports-cloudflare-quick"],
      ["frp tunnel", "/addons/ports-frp"],
    ]),
    group("Terminal UI", [
      ["Terminal UI", "/addons/bakers-ui"],
      ["bakers ui", "/addons/bakers-ui/reference"],
      ["Add a screen as a tab", "/addons/bakers-ui/tabs"],
      ["Tickets in the terminal", "/addons/bakers-ui/tickets"],
      ["Use the terminal UI", "/addons/bakers-ui/usage"],
      ["bakers ui keys", "/addons/bakers-ui-keys"],
      ["Artifacts", "/addons/bakers-ui-artifacts"],
    ]),
    group("Commands and time", [
      ["Agent catalog", "/addons/agents"],
      ["Project info", "/addons/info"],
      ["Deployment tickets", "/addons/deployment"],
      ["bakers deployment", "/addons/deployment/reference"],
      ["Time evidence", "/addons/track"],
    ]),
    group("Connection support", [
      ["Essentials", "/addons/essentials"],
      ["Name references", "/addons/name-refs"],
      ["Ambient workspace", "/addons/workspace"],
      ["HTTP Basic sign-in", "/addons/auth-basic"],
    ]),
    group("Internal test fixture", [
      ["Fake conductor fixture", "/addons/fake"],
    ]),
    group("Build your own", [
      ["Build your first addon", "/addons/build/first-addon"],
      ["Addon contracts", "/addons/build/contracts"],
      ["Write an executor or a workspace", "/addons/build/executor-workspace"],
      ["Write an addon with inbox messages", "/addons/build/actions"],
      ["Write an addon with agent tools", "/addons/build/tools"],
    ]),
  ],
  "/configuration/": [
    group("File map", [
      ["Files and precedence", "/configuration/files"],
    ]),
    group("Connector", [
      ["Overview", "/configuration/"],
      ["Connector", "/configuration/connector"],
      ["Connections", "/configuration/connector/connections"],
      ["Claude.ai connector limits and errors", "/configuration/connector/limits"],
      ["Get emails about ticket activity", "/configuration/connector/notifications"],
      ["Claude Project instructions (connector bundle)", "/configuration/connector/project-instructions"],
    ]),
    group("Machine", [
      ["Machine", "/configuration/machine"],
      ["Update bakers.build", "/configuration/machine/updates"],
    ]),
    group("Project", [
      ["Project", "/configuration/project"],
      ["Conductors", "/configuration/project/conductors"],
      ["Conductor commands", "/configuration/project/conductor-commands"],
      ["Configuration migration", "/configuration/project/migration"],
    ]),
    group("CLI reference", [
      ["CLI commands", "/configuration/clients/cli"],
      ["bakers tools", "/configuration/clients/tools"],
      ["bakers auth", "/configuration/clients/auth"],
      ["Switch to the bakers CLI", "/configuration/clients/switch-to-bakers"],
      ["Troubleshooting", "/configuration/clients/troubleshooting"],
    ]),
  ],
  "/self-hosting/": [
    group("Hosting choice", [
      ["Hosted or self-run", "/self-hosting/choosing"],
    ]),
    group("Self-hosting", [
      ["Overview", "/self-hosting/"],
      ["Server", "/self-hosting/server"],
      ["Komodo server", "/self-hosting/server-komodo"],
    ]),
  ],
  "/development/": [
    group("CLI contract", [
      ["Test the CLI contract", "/development/test-cli-contract"],
    ]),
    group("Development", [
      ["Overview", "/development/"],
      ["Add a skill test", "/development/add-skill-test"],
      ["Architecture", "/development/architecture"],
      ["Build the CLI from source", "/development/build-from-source"],
      ["Development", "/development/contributing"],
      ["Islands and profiles", "/development/islands-and-profiles"],
      ["Skill contract", "/development/skill-contract"],
      ["Test the coding outtake", "/development/test-run-outtake"],
      ["Test a skill's tool calls", "/development/test-skill-tools"],
      ["Test a skill", "/development/test-skills"],
      ["Write the docs", "/development/write-docs"],
    ]),
  ],
}
