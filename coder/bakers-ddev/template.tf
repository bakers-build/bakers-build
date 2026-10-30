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
  default     = "git.key-tec.de:5050/keytec/infra/coder-drupal-ddev-base:3.2.5"
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

provider "docker" {
  host = var.docker_host
}

data "coder_workspace" "me" {}

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
