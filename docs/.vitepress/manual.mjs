// Shared navigation and rendered-page exclusions for VitePress and its checks.
export const SRC_EXCLUDE = ["decisions/**", "bakers/**", "conductor/**", "development/**", "drupal-updates/**", "bakers-metrics.md", "node_modules/**"]

export const AREAS = [
  { label: "Get started", link: "/get-started/", icon: "guide" },
  { label: "Provision", link: "/provision/", icon: "contributing" },
  { label: "Agents", link: "/agents/", icon: "guide" },
  { label: "Skills & Workflows", link: "/skills-and-workflows/", icon: "guide" },
  { label: "Addons", link: "/addons/", icon: "reference" },
  { label: "Configuration", link: "/configuration/", icon: "contributing" },
  { label: "Self-hosting", link: "/self-hosting/", icon: "contributing" },
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
      ["Accept results", "/skills-and-workflows/accept-results"],
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
      ["Configure and select agents", "/agents/guide"],
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
    group("Start here", [
      ["Introduction", "/addons/"],
      ["Available addons", "/addons/catalog"],
      ["Configure addons", "/addons/configure"],
    ]),
    group("Build an addon", [
      ["Build your first addon", "/addons/build/first-addon"],
      ["Add a new agent harness", "/addons/build/agent"],
      ["Connect a new client", "/addons/build/client"],
      ["Extend the control panel", "/addons/build/control-panel"],
      ["Tools", "/addons/build/tools"],
      ["Messages", "/addons/build/actions"],
      ["Addon API reference", "/addons/build/contracts"],
      ["Executor and workspace API", "/addons/build/executor-workspace"],
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
      ["herdr-core", "/addons/herdr-core"],
      ["Orca", "/addons/orca"],
      ["Git workspace", "/addons/workspace-git"],
      ["Conductor slots", "/addons/slots"],
      ["bakers.build server remote", "/addons/remote-drupal"],
      ["Tailscale", "/addons/tailscale"],
      ["Docker runtime", "/addons/runtime-docker"],
      ["Bubblewrap runtime", "/addons/runtime-bwrap"],
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
    group("Delivery", [
      ["Forge", "/addons/forge"],
      ["Forge for GitHub", "/addons/forge-github"],
      ["Forge for GitLab", "/addons/forge-gitlab"],
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
      ["HTTP Basic sign-in", "/addons/auth-basic"],
    ]),
    group("Internal test fixture", [
      ["Fake conductor fixture", "/addons/fake"],
    ]),
  ],
  "/configuration/": [
    group("Configuration files", [
      ["Files and precedence", "/configuration/"],
      ["Connection", "/configuration/connection"],
      ["Machine", "/configuration/machine"],
      ["Project", "/configuration/project"],
      ["Lifecycle hooks", "/configuration/project/hooks"],
      ["Conductors and variants", "/configuration/project/conductors"],
    ]),
    group("Guides", [
      ["Update bakers.build", "/configuration/guides/updates"],
      ["Switch to the bakers CLI", "/configuration/guides/switch-to-bakers"],
      ["Get emails about ticket activity", "/configuration/guides/notifications"],
      ["Claude.ai connector limits and errors", "/configuration/guides/connector-limits"],
      ["Claude Project instructions (connector bundle)", "/configuration/guides/project-instructions"],
    ]),
    group("CLI reference", [
      ["CLI commands", "/cli/"],
      ["bakers conductor", "/cli/conductor"],
      ["bakers tools", "/cli/tools"],
      ["bakers auth", "/cli/auth"],
      ["Troubleshooting", "/cli/troubleshooting"],
    ]),
  ],
  "/cli/": [
    group("CLI reference", [
      ["CLI commands", "/cli/"],
      ["bakers conductor", "/cli/conductor"],
      ["bakers tools", "/cli/tools"],
      ["bakers auth", "/cli/auth"],
      ["Troubleshooting", "/cli/troubleshooting"],
    ]),
  ],
  "/self-hosting/": [
    group("Hosting choice", [
      ["Hosted or self-run", "/self-hosting/choosing"],
    ]),
    group("Self-hosting", [
      ["Overview", "/self-hosting/"],
      ["Server", "/self-hosting/server"],
      ["Reverse proxy", "/self-hosting/proxy"],
    ]),
  ],
}
