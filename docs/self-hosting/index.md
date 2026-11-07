# Self-hosting

Run the bakers.build application server on your infrastructure. It stores workspaces, tickets, comments and runs. Conductors and agents remain on separate execution machines; prepare those under [Provision](/provision/).

Start with [hosted or self-run](/self-hosting/choosing) to understand ownership and data. If you operate the server:

1. Follow [standalone installation](/self-hosting/server) with matching release artifacts and pinned public images.
2. Verify HTTPS, sign-in, mail and access before inviting users.
3. Take and verify a [backup](/self-hosting/server#restart-and-backup) before an [update](/self-hosting/server#update).
4. Practice [restoring onto isolated storage](/self-hosting/server#restore-onto-empty-isolated-storage).

Existing operator-managed stacks use the separate [Komodo procedure](/self-hosting/server-komodo). Keep its deployment choices separate from a new standalone installation.

The server owns ticket history; pointing a client at another instance does not migrate it. [Security](/security/) explains access and credentials. [Configuration](/configuration/) covers the client/worker files used to connect to the server.
