# Self-hosting

Run the bakers.build application server on your infrastructure. It stores workspaces, tickets, comments and runs. Conductors and agents remain on separate execution machines; prepare those under [Provision](/provision/).

Start with [hosted or self-run](/self-hosting/choosing) to understand ownership and data. If you operate the server:

1. Start the [server](/self-hosting/server) from one Docker Compose file.
2. Put a [reverse proxy](/self-hosting/proxy) in front of it for HTTPS.
3. Sign in, verify, and connect your machines.

The server owns ticket history; pointing a client at another instance does not migrate it.

## Connect clients and workers

Review access and the configuration used to connect to your server.

<DocQuickLinks aria-label="Connect clients and workers" :items="[
  { label: 'Security', text: 'Understand access boundaries and credentials before granting access.', link: '/agents/security' },
  { label: 'Configuration', text: 'Find the connection, machine and project settings used by clients and workers.', link: '/configuration/' }
]" />
