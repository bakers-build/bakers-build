#!/usr/bin/env bash
# The template validates and requires digests (AC-8): terraform validate, then tests/template.tftest.hcl.
# Uses a local terraform, else the hashicorp/terraform image. Needs the provider registry.
source "$(dirname "$0")/lib.sh"

dir="$(cd "$(dirname "$0")/.." && pwd)"
work=$(mktemp -d)
cp "$dir"/template.tf "$dir"/pm-bot.compose.yaml "$work"/ && cp -R "$dir"/scripts "$dir"/tests "$work"/
if command -v terraform >/dev/null; then
  tf() { (cd "$work" && terraform "$@"); }
else
  tf() { docker run --rm -v "$work:/w" -w /w hashicorp/terraform:1.9.8 "$@"; }
fi
check "terraform init" tf init -backend=false -input=false
check "terraform validate" tf validate
check "digest rules (terraform test)" tf test
rm -rf "$work"
finish
