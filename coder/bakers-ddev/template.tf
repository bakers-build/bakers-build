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
  description = "Workspace image with tag: Ubuntu 24.04, user coder with passwordless sudo, Docker daemon started by the entrypoint, Node 22 with an npm prefix in the home, DDEV"
  type        = string
  validation {
    condition     = length(trimspace(var.image)) > 0
    error_message = "Supply a publicly pullable, versioned workspace image meeting the README requirements."
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

variable "bakers_version" {
  description = "@bakers-build/bakers npm version"
  type        = string
  default     = "0.3.0"
}

variable "herdr_version" {
  description = "herdr release"
  type        = string
  default     = "0.9.5"
}

variable "claude_version" {
  description = "Claude Code release"
  type        = string
  default     = "2.1.306"
}

variable "codex_version" {
  description = "@openai/codex npm version"
  type        = string
  default     = "0.163.0"
}

variable "cursor_version" {
  description = "Cursor CLI release"
  type        = string
  default     = "2026.10.19-6bbf2c4"
}

variable "gh_version" {
  description = "GitHub CLI release"
  type        = string
  default     = "2.102.1"
}

variable "glab_version" {
  description = "GitLab CLI release"
  type        = string
  default     = "1.124.0"
}

variable "cloudflared_version" {
  description = "cloudflared release"
  type        = string
  default     = "2026.10.2"
}

variable "frp_version" {
  description = "frp release, the version the bakers.build frp transport is written against"
  type        = string
  default     = "0.68.0"
}

variable "pm_bot_image" {
  description = "The PM bot's image, tag and digest (ghcr.io/bakers-build/bakers-build/pm-bot:<tag>@sha256:<digest>; README › PM bot). Empty: no workspace runs the bot"
  type        = string
  default     = ""
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
  description  = "The one Slack channel ID the bot answers in (C0123). The bot refuses to start with more."
  type         = "string"
  default      = ""
  mutable      = true
  order        = 3
  form_type    = "input"
}

data "coder_parameter" "pm_bot_slack_allowed_users" {
  name         = "pm_bot_slack_allowed_users"
  display_name = "PM bot: allowed users"
  description  = "Optional. Slack member IDs the bot answers, separated by spaces or commas. Empty: everyone in the allowed channels."
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
  description  = "The Slack workspace URL, for thread permalinks (https://example.slack.com)."
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
  description  = "The bakers.build server (https://bakers.example.com)."
  type         = "string"
  default      = ""
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
  default      = "false"
  mutable      = true
  order        = 1
}

resource "coder_agent" "main" {
  arch           = "amd64"
  os             = "linux"
  startup_script = file("${path.module}/scripts/install.sh")

  # PATH reaches every session, also a non-login `coder ssh <workspace> -- <command>`, which reads neither ~/.profile nor ~/.bashrc.
  # DDEV_NO_INSTRUMENTATION keeps `ddev start` in a herdr pane from waiting on DDEV's usage-statistics question.
  env = {
    HOME                    = "/home/coder"
    PATH                    = "$HOME/.local/bin:$HOME/.npm-global/bin:$PATH"
    DDEV_NO_INSTRUMENTATION = "true"
    BB_VERSION              = var.bakers_version
    HERDR_VERSION           = var.herdr_version
    CLAUDE_VERSION          = var.claude_version
    CODEX_VERSION           = var.codex_version
    CURSOR_VERSION          = var.cursor_version
    GH_VERSION              = var.gh_version
    GLAB_VERSION            = var.glab_version
    CLOUDFLARED_VERSION     = var.cloudflared_version
    FRP_VERSION             = var.frp_version
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
