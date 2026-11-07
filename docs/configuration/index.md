# Configuration

Find the file that owns a setting before changing it. Start with the [file map and precedence](/configuration/files); it separates shared project configuration from private machine and connection values and includes one compact example.

| Reference | Owns |
|---|---|
| [Connections](/configuration/connector/connections) | Server selection, sign-in profiles and private connection files |
| [Machine](/configuration/machine) | Host identity, agent catalog and machine policy |
| [Project](/configuration/project) | Committed engine wiring, hooks and named conductor variants |
| [Clients](/configuration/clients) | Client selection and CLI reference |
| [Migration](/configuration/project/migration) | Retired shapes and supported upgrades |

Keep credentials and `.bakers/*.local.js` out of Git. JavaScript composition is explicit: a local conductor file changes the committed configuration only where that configuration imports it.

```sh
bakers config check --scope all --online
```

The report validates files and resolvable addons; it does not prove that a harness is installed/authenticated or that an application is ready. See [Agents](/agents/), [Security](/provision/security/) and [Provision](/provision/) for behavior and runtime checks.

## Installation and updates

Choose the guide for the part you need to set up or update.

<DocQuickLinks aria-label="Installation and updates" :items="[
  { label: 'Update bakers.build', text: 'Update an existing CLI installation, skills and configuration.', link: '/configuration/machine/updates' },
  { label: 'Self-hosting', text: 'Install or update an application server you operate.', link: '/self-hosting/' },
  { label: 'Get started', text: 'Prepare a new project or begin working with tickets.', link: '/get-started/' }
]" />
