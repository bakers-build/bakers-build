terraform {
  required_providers {
    coder = {
      source  = "coder/coder"
      version = ">= 2.13"
    }
    docker = {
      source  = "kreuzwerker/docker"
      version = "~> 3.0"
    }
  }
}

variable "docker_host" {
  description = "Docker host socket of the Coder server"
  type        = string
  default     = "unix:///var/run/docker.sock"
}

variable "image" {
  description = "The keytec bakers-ddev workspace image by digest (git.key-tec.de:5050/keytec/infra/coder-bakers-ddev:<tag>@sha256:<digest>; README › Push)"
  type        = string
  validation {
    condition     = can(regex("@sha256:[0-9a-f]{64}$", var.image))
    error_message = "image must be pinned by digest: <name>:<tag>@sha256:<64 hex>."
  }
}

variable "cpu" {
  description = "CPU cores"
  type        = number
  default     = 4
  validation {
    condition     = var.cpu >= 1 && var.cpu <= 32
    error_message = "CPU must be between 1 and 32"
  }
}

variable "memory" {
  description = "Memory in GB"
  type        = number
  default     = 8
  validation {
    condition     = var.memory >= 2 && var.memory <= 128
    error_message = "Memory must be between 2 and 128 GB"
  }
}

variable "disk_size" {
  description = "Disk size in GB, shown in the workspace metadata only (Docker volumes carry no quota)"
  type        = number
  default     = 50
  validation {
    condition     = var.disk_size >= 10 && var.disk_size <= 500
    error_message = "Disk size must be between 10 and 500 GB"
  }
}

variable "pm_bot_image" {
  description = "The PM bot's image, tag and digest (ghcr.io/bakers-build/bakers-build/pm-bot:<tag>@sha256:<digest>; README › PM bot). Empty: no workspace runs the bot"
  type        = string
  default     = ""
  validation {
    condition     = var.pm_bot_image == "" || can(regex("@sha256:[0-9a-f]{64}$", var.pm_bot_image))
    error_message = "pm_bot_image must be empty or pinned by digest: <name>:<tag>@sha256:<64 hex>."
  }
}

variable "pm_bot_registry_user" {
  description = "User name for pm_bot_image's registry; empty for the public GHCR image"
  type        = string
  default     = ""
}

variable "pm_bot_registry_token" {
  description = "Token for pm_bot_image's registry (e.g. a GitHub token with read:packages); empty for the public GHCR image"
  type        = string
  default     = ""
  sensitive   = true
}

provider "docker" {
  host = var.docker_host
}

data "coder_workspace" "me" {}

# The PM bot's configuration (README › PM bot). Mutable, so a value can be changed on an
# existing workspace; it applies on the next start. All empty means no bot.

data "coder_parameter" "pm_bot_slack_bot_token" {
  name         = "pm_bot_slack_bot_token"
  display_name = "PM bot: Slack bot token"
  description  = "The Slack app's bot token (xoxb-…). All PM bot parameters empty: no bot (README › PM bot)."
  type         = "string"
  default      = ""
  mutable      = true
  order        = 1
  form_type    = "input"
  styling      = jsonencode({ mask_input = true })
}

data "coder_parameter" "pm_bot_slack_app_token" {
  name         = "pm_bot_slack_app_token"
  display_name = "PM bot: Slack app token"
  description  = "The Slack app's Socket Mode token (xapp-…)."
  type         = "string"
  default      = ""
  mutable      = true
  order        = 2
  form_type    = "input"
  styling      = jsonencode({ mask_input = true })
}

data "coder_parameter" "pm_bot_slack_allowed_channels" {
  name         = "pm_bot_slack_allowed_channels"
  display_name = "PM bot: allowed channels"
  description  = "The bot's main Slack channel ID (C0123), where a mention opens a request channel. The bot refuses to start with more."
  type         = "string"
  default      = ""
  mutable      = true
  order        = 3
  form_type    = "input"
}

data "coder_parameter" "pm_bot_slack_allowed_users" {
  name         = "pm_bot_slack_allowed_users"
  display_name = "PM bot: allowed users"
  description  = "Optional. Slack member IDs the bot answers, separated by spaces or commas. Empty: everyone in its channels."
  type         = "string"
  default      = ""
  mutable      = true
  order        = 4
  form_type    = "input"
}

data "coder_parameter" "pm_bot_slack_admin_users" {
  name         = "pm_bot_slack_admin_users"
  display_name = "PM bot: operators"
  description  = "Slack member IDs that may run Hermes slash commands, separated by spaces or commas. Must not be empty."
  type         = "string"
  default      = ""
  mutable      = true
  order        = 5
  form_type    = "input"
}

data "coder_parameter" "pm_bot_slack_workspace_url" {
  name         = "pm_bot_slack_workspace_url"
  display_name = "PM bot: Slack workspace URL"
  description  = "The Slack workspace URL, for channel links (https://example.slack.com)."
  type         = "string"
  default      = ""
  mutable      = true
  order        = 6
  form_type    = "input"
}

data "coder_parameter" "pm_bot_slack_home_channel" {
  name         = "pm_bot_slack_home_channel"
  display_name = "PM bot: home channel"
  description  = "Optional. A channel ID only the operators are in, for Hermes' restart notices."
  type         = "string"
  default      = ""
  mutable      = true
  order        = 7
  form_type    = "input"
}

data "coder_parameter" "pm_bot_bakers_url" {
  name         = "pm_bot_bakers_url"
  display_name = "PM bot: bakers.build URL"
  description  = "The bakers.build server; keytec's by default."
  type         = "string"
  default      = local.bakers_url
  mutable      = true
  order        = 8
  form_type    = "input"
}

data "coder_parameter" "pm_bot_bakers_api_key" {
  name         = "pm_bot_bakers_api_key"
  display_name = "PM bot: bakers.build API key"
  description  = "API key of the bot's service account, sent as the bearer on bakers.build's /mcp."
  type         = "string"
  default      = ""
  mutable      = true
  order        = 9
  form_type    = "input"
  styling      = jsonencode({ mask_input = true })
}

data "coder_parameter" "pm_bot_project" {
  name         = "pm_bot_project"
  display_name = "PM bot: project UUID"
  description  = "UUID of the bakers.build project the bot creates and follows tickets in."
  type         = "string"
  default      = ""
  mutable      = true
  order        = 11
  form_type    = "input"
}

data "coder_parameter" "pm_bot_ticket_workflow" {
  name         = "pm_bot_ticket_workflow"
  display_name = "PM bot: ticket workflow"
  description  = "Workflow of the tickets the bot creates (default bb_work)."
  type         = "string"
  default      = "bb_work"
  mutable      = true
  order        = 12
  form_type    = "input"
}

data "coder_parameter" "pm_bot_conductor" {
  name         = "pm_bot_conductor"
  display_name = "PM bot: conductor UUID"
  description  = "Optional. The conductor set on each new ticket. Empty: tickets wait until someone sets one."
  type         = "string"
  default      = ""
  mutable      = true
  order        = 13
  form_type    = "input"
}

data "coder_parameter" "pm_bot_anthropic_api_key" {
  name         = "pm_bot_anthropic_api_key"
  display_name = "PM bot: Anthropic API key"
  description  = "The model credential. Set exactly one of this and the Claude OAuth token."
  type         = "string"
  default      = ""
  mutable      = true
  order        = 14
  form_type    = "input"
  styling      = jsonencode({ mask_input = true })
}

data "coder_parameter" "pm_bot_claude_oauth_token" {
  name         = "pm_bot_claude_oauth_token"
  display_name = "PM bot: Claude OAuth token"
  description  = "Alternative model credential, from `claude setup-token`; for tests. Set exactly one of the two."
  type         = "string"
  default      = ""
  mutable      = true
  order        = 15
  form_type    = "input"
  styling      = jsonencode({ mask_input = true })
}

data "coder_parameter" "pm_bot_model" {
  name         = "pm_bot_model"
  display_name = "PM bot: model"
  description  = "The Claude model the bot runs on."
  type         = "string"
  default      = "claude-sonnet-5-5"
  mutable      = true
  order        = 16
  form_type    = "input"
}

data "coder_parameter" "pm_bot_repo_url" {
  name         = "pm_bot_repo_url"
  display_name = "PM bot: repository URL"
  description  = "Optional. HTTPS URL of the project's repository, without credentials; the bot reads a secret-free clone. Empty: no code access."
  type         = "string"
  default      = ""
  mutable      = true
  order        = 17
  form_type    = "input"
}

data "coder_parameter" "pm_bot_repo_user" {
  name         = "pm_bot_repo_user"
  display_name = "PM bot: repository user"
  description  = "Optional. User name of a read-only token for the repository URL."
  type         = "string"
  default      = ""
  mutable      = true
  order        = 18
  form_type    = "input"
}

data "coder_parameter" "pm_bot_repo_token" {
  name         = "pm_bot_repo_token"
  display_name = "PM bot: repository token"
  description  = "Optional. Read-only token (read_repository) for the repository URL; used only while cloning."
  type         = "string"
  default      = ""
  mutable      = true
  order        = 19
  form_type    = "input"
  styling      = jsonencode({ mask_input = true })
}

data "coder_parameter" "conductor_autostart" {
  name         = "conductor_autostart"
  display_name = "Start conductors on workspace start"
  description  = "On: every start runs `bakers oven start` in each ~/projects/* checkout that has .bakers/conductor.config.js (README › Conductor autostart). Off: conductors are yours to start."
  type         = "bool"
  default      = "true"
  mutable      = true
  order        = 20
}

# keytec defaults (README › keytec defaults): not secret, so they live here and not in parameters.
locals {
  bakers_url  = "https://app.bakers.build"
  gitlab_host = "git.key-tec.de"
}

# Service accounts and sign-ins (README › Git, bakers.build sign-in, Previews). Mutable; a change
# applies on the next start. Sensitive values are masked and reach the start script only.

data "coder_parameter" "github_token" {
  name         = "github_token"
  display_name = "Git: GitHub token"
  description  = "Access token of the GitHub service account (repo scope). gh signs in with it and serves git's github.com credentials. Empty: no GitHub sign-in."
  type         = "string"
  default      = ""
  mutable      = true
  order        = 30
  form_type    = "input"
  styling      = jsonencode({ mask_input = true })
}

data "coder_parameter" "gitlab_token" {
  name         = "gitlab_token"
  display_name = "Git: GitLab token"
  description  = "Access token of the git.key-tec.de service account (api, write_repository). glab signs in with it and serves git's git.key-tec.de credentials. Empty: no GitLab sign-in."
  type         = "string"
  default      = ""
  mutable      = true
  order        = 31
  form_type    = "input"
  styling      = jsonencode({ mask_input = true })
}

data "coder_parameter" "git_user_name" {
  name         = "git_user_name"
  display_name = "Git: commit name"
  description  = "The commit author name of the service identity."
  type         = "string"
  default      = "keytec bakers"
  mutable      = true
  order        = 32
  form_type    = "input"
}

data "coder_parameter" "git_user_email" {
  name         = "git_user_email"
  display_name = "Git: commit email"
  description  = "The commit author email of the service identity."
  type         = "string"
  default      = "bakers@keytec.de"
  mutable      = true
  order        = 33
  form_type    = "input"
}

data "coder_parameter" "bakers_client_id" {
  name         = "bakers_client_id"
  display_name = "bakers.build: OAuth client ID"
  description  = "Client ID of the box's bakers.build consumer (client credentials). Used once, when the box has no connection yet."
  type         = "string"
  default      = ""
  mutable      = true
  order        = 34
  form_type    = "input"
}

data "coder_parameter" "bakers_client_secret" {
  name         = "bakers_client_secret"
  display_name = "bakers.build: OAuth client secret"
  description  = "Secret of that consumer. bakers init stores it in ~/.bakers/bakers.config.js (0600)."
  type         = "string"
  default      = ""
  mutable      = true
  order        = 35
  form_type    = "input"
  styling      = jsonencode({ mask_input = true })
}

data "coder_parameter" "projects" {
  name         = "projects"
  display_name = "Projects"
  description  = "HTTPS repository URLs, separated by spaces, commas or new lines. Each start clones a missing one into ~/projects/<name>; an existing checkout is never touched."
  type         = "string"
  default      = ""
  mutable      = true
  order        = 36
  form_type    = "textarea"
}

data "coder_parameter" "frp_enrollment" {
  name         = "frp_enrollment"
  display_name = "Previews: FRP enrollment"
  description  = "The box's FRP enrollment string (bkfrp1.…). Set: runs share preview links over frps (BB_TUNNEL=1). Empty: no previews."
  type         = "string"
  default      = ""
  mutable      = true
  order        = 37
  form_type    = "input"
  styling      = jsonencode({ mask_input = true })
}

resource "coder_agent" "main" {
  arch           = "amd64"
  os             = "linux"
  startup_script = file("${path.module}/scripts/install.sh")

  # PATH reaches every session, also a non-login `coder ssh <workspace> -- <command>`, which reads
  # neither ~/.profile nor ~/.bashrc. /usr/local/bin comes first, so tool copies an older home volume
  # still holds never shadow the image's pinned ones.
  # DDEV_NO_INSTRUMENTATION keeps `ddev start` in a herdr pane from waiting on DDEV's usage-statistics question.
  env = {
    HOME                    = "/home/coder"
    PATH                    = "/usr/local/bin:$HOME/.local/bin:$HOME/.npm-global/bin:$PATH"
    DDEV_NO_INSTRUMENTATION = "true"
    DISABLE_AUTOUPDATER     = "1"
    WORKSPACE_NAME          = data.coder_workspace.me.name
    # Sign-ins (scripts/git-setup.sh, bakers-setup.sh, frp-setup.sh). Never in coder_metadata.
    BOX_GITHUB_TOKEN     = data.coder_parameter.github_token.value
    BOX_GITLAB_TOKEN     = data.coder_parameter.gitlab_token.value
    GITLAB_HOST          = local.gitlab_host
    GIT_USER_NAME        = data.coder_parameter.git_user_name.value
    GIT_USER_EMAIL       = data.coder_parameter.git_user_email.value
    BAKERS_URL           = local.bakers_url
    BAKERS_CLIENT_ID     = data.coder_parameter.bakers_client_id.value
    BAKERS_CLIENT_SECRET = data.coder_parameter.bakers_client_secret.value
    BOX_PROJECTS         = data.coder_parameter.projects.value
    BOX_FRP_ENROLLMENT   = data.coder_parameter.frp_enrollment.value
    # Conductor autostart (scripts/conductors.sh).
    BAKERS_CONDUCTOR_AUTOSTART = data.coder_parameter.conductor_autostart.value
    # The PM bot (scripts/pm-bot.sh). Never in coder_metadata: secrets stay off the workspace page.
    PM_BOT_IMAGE                  = var.pm_bot_image
    PM_BOT_REGISTRY_USER          = var.pm_bot_registry_user
    PM_BOT_REGISTRY_TOKEN         = var.pm_bot_registry_token
    PM_BOT_SLACK_BOT_TOKEN        = data.coder_parameter.pm_bot_slack_bot_token.value
    PM_BOT_SLACK_APP_TOKEN        = data.coder_parameter.pm_bot_slack_app_token.value
    PM_BOT_SLACK_ALLOWED_CHANNELS = data.coder_parameter.pm_bot_slack_allowed_channels.value
    PM_BOT_SLACK_ALLOWED_USERS    = data.coder_parameter.pm_bot_slack_allowed_users.value
    PM_BOT_SLACK_ADMIN_USERS      = data.coder_parameter.pm_bot_slack_admin_users.value
    PM_BOT_SLACK_WORKSPACE_URL    = data.coder_parameter.pm_bot_slack_workspace_url.value
    PM_BOT_SLACK_HOME_CHANNEL     = data.coder_parameter.pm_bot_slack_home_channel.value
    PM_BOT_BAKERS_URL             = data.coder_parameter.pm_bot_bakers_url.value
    PM_BOT_BAKERS_API_KEY         = data.coder_parameter.pm_bot_bakers_api_key.value
    PM_BOT_PROJECT                = data.coder_parameter.pm_bot_project.value
    PM_BOT_TICKET_WORKFLOW        = data.coder_parameter.pm_bot_ticket_workflow.value
    PM_BOT_CONDUCTOR              = data.coder_parameter.pm_bot_conductor.value
    PM_BOT_ANTHROPIC_API_KEY      = data.coder_parameter.pm_bot_anthropic_api_key.value
    PM_BOT_CLAUDE_OAUTH_TOKEN     = data.coder_parameter.pm_bot_claude_oauth_token.value
    PM_BOT_MODEL                  = data.coder_parameter.pm_bot_model.value
    PM_BOT_REPO_URL               = data.coder_parameter.pm_bot_repo_url.value
    PM_BOT_REPO_USER              = data.coder_parameter.pm_bot_repo_user.value
    PM_BOT_REPO_TOKEN             = data.coder_parameter.pm_bot_repo_token.value
  }

  metadata {
    display_name = "bakers.build worker workspace"
    key          = "0"
    script       = "coder stat"
    interval     = 1
    timeout      = 1
  }

  # Health at a glance (README › Health): a stopped bot shows down within one interval.
  metadata {
    display_name = "PM bot"
    key          = "pm_bot"
    script       = "bash /usr/local/share/bakers-ddev/health.sh pm-bot"
    interval     = 10
    timeout      = 2
  }

  metadata {
    display_name = "PM bot poller"
    key          = "poller"
    script       = "bash /usr/local/share/bakers-ddev/health.sh poller"
    interval     = 10
    timeout      = 2
  }

  metadata {
    display_name = "Conductor"
    key          = "conductor"
    script       = "bash /usr/local/share/bakers-ddev/health.sh conductor"
    interval     = 30
    timeout      = 2
  }
}

resource "docker_image" "workspace" {
  name         = var.image
  keep_locally = true
}

# Named by workspace ID, so renaming the workspace keeps both volumes.
resource "docker_volume" "home" {
  name = "coder-${data.coder_workspace.me.id}-home"
}

resource "docker_volume" "docker" {
  name = "coder-${data.coder_workspace.me.id}-docker"
}

resource "docker_container" "workspace" {
  count    = data.coder_workspace.me.start_count
  image    = docker_image.workspace.image_id
  name     = "coder-${data.coder_workspace.me.id}"
  hostname = data.coder_workspace.me.name
  user     = "coder"

  # The container is recreated on every start; only the volumes persist.
  # Stop timeout leaves dockerd and DDEV time to shut down.
  stop_timeout = 180
  stop_signal  = "SIGTERM"
  restart      = "unless-stopped"

  cpu_shares = var.cpu * 1024
  memory     = var.memory * 1024

  # Sysbox gives the workspace its own Docker daemon without privileged mode.
  runtime    = "sysbox-runc"
  privileged = false
  security_opts = [
    "apparmor:unconfined",
    "seccomp:unconfined",
  ]

  mounts {
    type   = "volume"
    source = docker_volume.home.name
    target = "/home/coder"
  }

  mounts {
    type   = "volume"
    source = docker_volume.docker.name
    target = "/var/lib/docker"
  }

  # The PM bot's start script and compose file. Root-owned, so coder's tools cannot change
  # them; the bot's data lives in the home volume (README › PM bot).
  upload {
    content    = file("${path.module}/scripts/pm-bot.sh")
    file       = "/usr/local/bin/pm-bot"
    executable = true
  }

  # The conductor autostart (README › Conductor autostart), root-owned like the bot's script.
  upload {
    content    = file("${path.module}/scripts/conductors.sh")
    file       = "/usr/local/bin/bakers-conductors"
    executable = true
  }

  upload {
    content = file("${path.module}/pm-bot.compose.yaml")
    file    = "/usr/local/share/pm-bot/compose.yaml"
  }

  # The start script's steps (scripts/install.sh) and the health items, root-owned.
  upload {
    content    = file("${path.module}/scripts/git-setup.sh")
    file       = "/usr/local/share/bakers-ddev/git-setup.sh"
    executable = true
  }

  upload {
    content    = file("${path.module}/scripts/bakers-setup.sh")
    file       = "/usr/local/share/bakers-ddev/bakers-setup.sh"
    executable = true
  }

  upload {
    content    = file("${path.module}/scripts/projects.sh")
    file       = "/usr/local/share/bakers-ddev/projects.sh"
    executable = true
  }

  upload {
    content    = file("${path.module}/scripts/frp-setup.sh")
    file       = "/usr/local/share/bakers-ddev/frp-setup.sh"
    executable = true
  }

  upload {
    content    = file("${path.module}/scripts/frp-config.mjs")
    file       = "/usr/local/share/bakers-ddev/frp-config.mjs"
    executable = true
  }

  upload {
    content    = file("${path.module}/scripts/machine-config.mjs")
    file       = "/usr/local/share/bakers-ddev/machine-config.mjs"
    executable = true
  }

  upload {
    content    = file("${path.module}/scripts/health.sh")
    file       = "/usr/local/share/bakers-ddev/health.sh"
    executable = true
  }

  env = ["CODER_AGENT_TOKEN=${coder_agent.main.token}"]

  # The image entrypoint starts dockerd, then runs the agent init script.
  command = ["/home/coder-files/bin/coder-entrypoint.sh", base64encode(coder_agent.main.init_script)]
}

resource "coder_metadata" "workspace_info" {
  count       = data.coder_workspace.me.start_count
  resource_id = docker_container.workspace[0].id

  item {
    key   = "image"
    value = docker_image.workspace.name
  }
  item {
    key   = "cpu"
    value = "${var.cpu} cores"
  }
  item {
    key   = "memory"
    value = "${var.memory} GB"
  }
  item {
    key   = "disk_size"
    value = "${var.disk_size} GB"
  }
}
