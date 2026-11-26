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
      ["Run the first ticket", "/get-started/run-the-first-ticket"],
    ]),
    group("Daily work", [
      ["Create a ticket", "/get-started/daily-work/create-a-ticket"],
      ["Follow a ticket", "/get-started/daily-work/follow-a-ticket"],
      ["Accept results", "/skills-and-workflows/accept-results"],
      ["Freeze a ticket", "/get-started/daily-work/freeze-a-ticket"],
      ["Record time", "/get-started/daily-work/record-time"],
      ["See what the team works on", "/get-started/daily-work/see-what-the-team-works-on"],
    ]),
    group("Chat access", [
      ["Connect your chat", "/get-started/connect-your-chat"],
    ]),
  ],
  "/provision/": [
    group("Setup path", [
      ["Overview", "/provision/"],
      ["Choose where agents run", "/provision/machine"],
      ["Prepare your project", "/get-started/connect-a-project"],
      ["Run the first ticket", "/get-started/run-the-first-ticket"],
    ]),
    group("Tools and access", [
      ["Tools and integrations", "/provision/tools-and-integrations"],
    ]),
    group("Machine setup", [
      ["Set up a worker server", "/provision/worker-server"],
    ]),
    group("Project environment", [
      ["Prepare a worktree environment", "/provision/guide"],
      ["Choose an example", "/provision/choose-an-example"],
      ["DDEV", "/addons/ddev/setup"],
      ["Docker Compose", "/provision/docker-compose"],
      ["Node.js application", "/provision/node-js-application"],
    ]),
    group("Lifecycle", [
      ["Add lifecycle hooks", "/provision/add-lifecycle-hooks"],
    ]),
    group("Security", [
      ["Permissions and isolation", "/agents/permissions-and-isolation"],
      ["Agent permissions", "/provision/security/execution"],
      ["Isolation models", "/agents/isolation-models"],
      ["Configure permissions", "/provision/security/shared-settings"],
      ["Access and data", "/provision/security/access-and-data"],
      ["API keys and service accounts", "/provision/security/api-keys-and-service-accounts"],
    ]),
  ],
  "/agents/": [
    group("Agents", [
      ["Overview", "/agents/"],
      ["Configure and select agents", "/agents/configure-and-select-agents"],
      ["Agent policy reference", "/agents/agent-policy-reference"],
      ["Permissions and isolation", "/agents/permissions-and-isolation"],
      ["Isolation models", "/agents/isolation-models"],
    ]),
  ],
  "/skills-and-workflows/": [
    group("Adapt your workflow", [
      ["Overview", "/skills-and-workflows/"],
      ["Set project rules", "/skills-and-workflows/workflow-file"],
      ["Choose a method", "/skills-and-workflows/recipes"],
      ["Decide when people approve", "/skills-and-workflows/decide-when-people-approve"],
    ]),
    group("Reference and setup", [
      ["Workflow reference", "/skills-and-workflows/workflow-reference"],
      ["Install the bakers skills", "/skills-and-workflows/install-the-bakers-skills"],
      ["Accept results", "/skills-and-workflows/accept-results"],
      ["Ticket metrics", "/skills-and-workflows/ticket-metrics"],
    ]),
  ],
  "/addons/": [
    group("Start here", [
      ["Introduction", "/addons/"],
      ["Available addons", "/addons/available-addons"],
      ["Configure addons", "/addons/configure-addons"],
    ]),
    group("Build an addon", [
      ["Build your first addon", "/addons/build/build-your-first-addon"],
      ["Add a new agent harness", "/addons/build/add-a-new-agent-harness"],
      ["Connect a new client", "/addons/build/connect-a-new-client"],
      ["Extend the control panel", "/addons/build/extend-the-control-panel"],
      ["Tools", "/addons/build/tools"],
      ["Messages", "/addons/build/messages"],
      ["Addon API reference", "/addons/build/addon-api-reference"],
      ["Executor and workspace API", "/addons/build/executor-and-workspace-api"],
      ["Write a runtime addon", "/addons/build/write-a-runtime-addon"],
    ]),
    group("Agents", [
      ["Claude", "/addons/claude"],
      ["Codex", "/addons/codex"],
      ["Codex trusted commands", "/addons/codex/trusted-commands"],
      ["Grok", "/addons/grok"],
      ["OpenCode", "/addons/opencode"],
      ["Pi", "/addons/pi"],
    ]),
    group("Clients and workspaces", [
      ["herdr", "/addons/herdr"],
      ["herdr-core", "/addons/herdr-core"],
      ["Orca", "/addons/orca"],
      ["Rex", "/addons/rex"],
      ["Git workspace", "/addons/workspace-git"],
      ["Conductor slots", "/addons/slots"],
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
    ]),
    group("Commands and time", [
      ["Agent catalog", "/addons/agents"],
      ["Deployment tickets", "/addons/deployment"],
      ["bakers deployment", "/addons/deployment/reference"],
      ["Time evidence", "/addons/track"],
    ]),
  ],
  "/configuration/": [
    group("Configuration files", [
      ["Files and precedence", "/configuration/"],
      ["Connection", "/configuration/connection"],
      ["Machine", "/configuration/machine"],
      ["Project", "/configuration/project"],
      ["Slot catalogs", "/configuration/slot-catalogs"],
      ["Lifecycle hooks", "/configuration/project/hooks"],
      ["Conductors and variants", "/configuration/project/conductors-and-variants"],
    ]),
    group("Guides", [
      ["Update bakers.build", "/configuration/guides/update-bakers-build"],
      ["Switch to the bakers CLI", "/configuration/guides/switch-to-the-bakers-cli"],
      ["Get emails about ticket activity", "/configuration/guides/get-emails-about-ticket-activity"],
      ["Connector limits and errors", "/configuration/guides/connector-limits-and-errors"],
      ["Claude Project instructions", "/configuration/guides/claude-project-instructions"],
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
      ["Hosted or self-run", "/self-hosting/hosted-or-self-run"],
    ]),
    group("Self-hosting", [
      ["Overview", "/self-hosting/"],
      ["Server", "/self-hosting/server"],
      ["Reverse proxy", "/self-hosting/reverse-proxy"],
    ]),
  ],
}
