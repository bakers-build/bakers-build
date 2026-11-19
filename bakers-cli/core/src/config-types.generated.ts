// Generated from core/schema/*.schema.json by core/scripts/schema-types.mjs.
// Do not edit: change the schema and run `node core/scripts/schema-types.mjs`.

/** A project's committed conductor configuration: .bakers/project.config.js and its variants .bakers/project.<name>.config.js. */
export interface ProjectConfig {
  /** Configuration schema version. */
  schema_version?: 1;
  /** The bakers.build project this repository belongs to. */
  project: {
    /** Project name on the server; BAKERS_PROJECT overrides it. */
    name: string;
    /** Team workspace the project belongs to. */
    workspace?: string;
  };
  permissions?: {
    mode?: "sandbox" | "system" | "yolo";
    sandbox?: {
      deny_read?: Array<string>;
      allow_write?: Array<string>;
      trusted_commands?: Array<string>;
    };
  };
  /** Addons this project uses. */
  addons?: Array<string | {
    use: string;
    alias?: string;
    /** The addon's options. */
    with?: unknown;
    priority?: (...args: never[]) => unknown;
  }>;
  /** Explicit server slot; wins over an addon's. */
  server?: { kind: string; [key: string]: unknown } | {
    use: string;
    export?: string;
    /** Options passed to the factory. */
    with?: unknown;
  };
  /** Explicit executor slot; the machine's wins over it. */
  executor?: { kind: string; [key: string]: unknown } | {
    use: string;
    export?: string;
    /** Options passed to the factory. */
    with?: unknown;
  };
  /** Explicit worktree slot; wins over an addon's. */
  worktree?: { kind: string; [key: string]: unknown } | {
    use: string;
    export?: string;
    /** Options passed to the factory. */
    with?: unknown;
  };
  /** States this conductor serves; empty or absent serves all. */
  states?: Array<string>;
  /** Agent prompt; placeholders {identifier}, {state}, {run_uuid}, {ticket_uuid}. */
  prompt?: string;
  /** Poll interval in milliseconds. Default 5000. */
  poll_interval_ms?: number;
  /** Run lease in seconds. Default 300. */
  lease_seconds?: number;
  /** Restart the foreground conductor when a config file changes. Default true. */
  restart_on_change?: boolean;
  /** Upload transcripts where the server allows it. Default true. */
  capture_logs?: boolean;
  /** Shell commands the conductor runs in a ticket's worktree. */
  hooks?: {
    after_create?: string;
    before_run?: string;
    after_run?: string;
    after_done?: string;
    on_freeze?: string;
    on_resume?: string;
    /** Command, or commands by profile, offered to runs as provision_up(profile?). A profile is a command, or { command, description } to tell the agent what it does. */
    provision_up?: string | {
      [key: string]: string | {
        command: string;
        /** One line for the agent, listed in the provision_up tool description: what the profile brings up and when to use it. */
        description?: string;
      };
    };
    /** Commands by key, offered to runs as provision_exec(key, args). A string is a fixed command that takes no arguments; { command, args: true } also passes the run's arguments as argv after --, never through a shell; an optional description tells the agent what the key does. */
    provision_exec?: {
      [key: string]: string | {
        command: string;
        /** Pass the run's arguments to the command. */
        args?: boolean;
        /** One line for the agent, listed in the provision_exec tool description: what the key runs and which args it takes. */
        description?: string;
      };
    };
  };
  /** Agent plugin marketplaces every run of this project installs. */
  marketplaces?: Array<{
    /** a remote Git URL (https, ssh or git@) */
    url: string;
    /** Branch or tag. */
    ref: string;
    /** Plugins to install from this marketplace, at least one. */
    plugins: Array<string>;
  }>;
  /** Function choosing the agent for a ticket; replaces the shipped selection. */
  select_agent?: (...args: never[]) => unknown;
  runtime?: {
    /** Machine runtime aliases this project may use; absent allows all. */
    enabled?: Array<string>;
    /** Runtime alias for tickets no label or machine route places. */
    default?: string;
    /** Under an isolating runtime: worktree-relative paths the run sees read-only and may not change in a commit. Host commands must start in one of them. .bakers is always protected. */
    read_only?: Array<string>;
  };
}

/** This machine's private configuration: ~/.bakers/machine.config.js. */
export interface MachineConfig {
  /** Configuration schema version. */
  schema_version?: 1;
  /** Host key; bakers init writes a UUID. */
  machine_id: string;
  /** Display name for people. */
  label: string;
  /** Public SSH or HTTPS connection address; null clears it at the next conductor start. */
  connection_url?: string | null;
  /** Selection policy for the agents the addons contribute. */
  agents?: {
    /** Extra agent variants built from installed harnesses. */
    catalog?: Array<{
      harness: string;
      alias?: string;
      /** The harness options. */
      with?: unknown;
    }>;
    enabled?: Array<string>;
    disabled?: Array<string>;
    /** Named routes from states (or *) to aliases; routes.default is the automatic one. */
    routes?: {
      [key: string]: {
        [key: string]: string;
      };
    };
    /** Function (aliases, ticket) => alias replacing the default agent order. */
    select?: (...args: never[]) => unknown;
  };
  /** Where agent runs start, chosen per ticket. Absent: the addon runtime, else the host (system). */
  runtime?: {
    /** Runtime entries; the alias system is the host and always present. */
    catalog?: Array<{
      alias: string;
      use: string;
      /** The runtime addon's options. */
      with?: unknown;
    }>;
    /** Named routes from states (or *) to aliases; routes.default is the automatic one. */
    routes?: {
      [key: string]: {
        [key: string]: string;
      };
    };
    /** Function (aliases, ticket) => alias replacing the default runtime order. */
    select?: (...args: never[]) => unknown;
    /** Let a runtime:<alias> label choose a runtime that does not isolate. Default false. */
    allow_unsandboxed?: boolean;
  };
  /** Addons this machine uses. */
  addons?: Array<string | {
    use: string;
    alias?: string;
    /** The addon's options. */
    with?: unknown;
    priority?: (...args: never[]) => unknown;
  }>;
  /** Share local preview links through bakers ports. Default false. */
  tunnel?: boolean;
  permissions?: {
    mode?: "sandbox" | "system" | "yolo";
    sandbox?: {
      deny_read?: Array<string>;
      allow_write?: Array<string>;
      trusted_commands?: Array<string>;
    };
  };
  /** This machine's executor; overrides every project's. */
  executor?: { kind: string; [key: string]: unknown } | {
    use: string;
    export?: string;
    /** Options passed to the factory. */
    with?: unknown;
  };
}

/** A connection to a bakers.build server: ~/.bakers/connections/<id>.js, or a project's .bakers/connection.config.js. dropsh reads the same file. */
export interface ConnectionConfig {
  /** Configuration schema version. */
  schema_version?: 1;
  site: {
    /** The server's absolute HTTP(S) URL. */
    base_url: string;
    /** JSON:API path prefix. Default /jsonapi. */
    jsonapi_prefix?: string;
  };
  /** Workspace bakers ui starts focused on. */
  workspace_id?: string;
  /** dropsh plugins: { plugin, export?, with?, options? }, or constructed plugins. */
  plugins?: Array<unknown | {
    [key: string]: unknown;
  }>;
  /** Conductor server slot for this connection; a project server slot or server addon wins. Default @bakers-build/addon-remote-drupal. */
  server?: { kind: string; [key: string]: unknown } | {
    use: string;
    export?: string;
    /** Options passed to the factory. */
    with?: unknown;
  };
  /** Connection addons, such as auth providers. */
  addons?: Array<string | {
    use: string;
    alias?: string;
    /** The addon's options. */
    with?: unknown;
    priority?: (...args: never[]) => unknown;
  }>;
}
