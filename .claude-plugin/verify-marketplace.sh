#!/usr/bin/env bash
# Executable acceptance for BB-62 — the standalone bakers.build marketplace plugin.
# Mirrors the ticket's Gherkin scenarios 1:1 (there is no web/Playwright runtime
# surface for a plugin manifest, so acceptance is asserted here via shell).
# Run from the repo root. Exit 0 = all scenarios green.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

MKT=".claude-plugin/marketplace.json"
PLUGIN=".claude/skills/bakers-build/.claude-plugin/plugin.json"
fail() { echo "FAIL: $1"; exit 1; }
ok()   { echo "  ok: $1"; }

echo "Scenario: marketplace is standalone and independent of keytec"
python3 -m json.tool "$MKT" >/dev/null || fail "$MKT is not valid JSON"
[ "$(python3 -c 'import json;print(json.load(open(".claude-plugin/marketplace.json"))["name"])')" = "bakers" ] \
  || fail "marketplace name is not \"bakers\""
[ "$(python3 -c 'import json;print(len(json.load(open(".claude-plugin/marketplace.json"))["plugins"]))')" = "1" ] \
  || fail "marketplace must list exactly one plugin"
[ "$(python3 -c 'import json;print(json.load(open(".claude-plugin/marketplace.json"))["plugins"][0]["name"])')" = "bakers" ] \
  || fail "the one plugin is not named \"bakers\""
! grep -qi "laws-of-robotics" "$MKT" || fail "marketplace references laws-of-robotics"
! grep -qi "laws-of-robotics" "$PLUGIN" || fail "plugin references laws-of-robotics"
ok "standalone bakers marketplace, one bakers plugin, no laws-of-robotics"

echo "Scenario: the bakers plugin carries a valid manifest"
python3 -m json.tool "$PLUGIN" >/dev/null || fail "$PLUGIN is not valid JSON"
[ "$(python3 -c 'import json;print(json.load(open(".claude/skills/bakers-build/.claude-plugin/plugin.json"))["name"])')" = "bakers" ] \
  || fail "plugin name is not \"bakers\""
[ -n "$(python3 -c 'import json;print(json.load(open(".claude/skills/bakers-build/.claude-plugin/plugin.json"))["version"])')" ] \
  || fail "plugin has no version"
# Since BB-182/204 the plugin ships a BUNDLE of named skills under `skills/`, not one
# monolithic SKILL.md at its root, so the declared skills dir is "./skills".
[ "$(python3 -c 'import json;print(json.load(open(".claude/skills/bakers-build/.claude-plugin/plugin.json"))["skills"])')" = "./skills" ] \
  || fail "plugin skills is not \"./skills\""
ok "plugin.json: name bakers, version present, skills ./skills"

echo "Scenario: single source of truth — source points at the repo-local skill dir"
SRC="$(python3 -c 'import json;print(json.load(open(".claude-plugin/marketplace.json"))["plugins"][0]["source"])')"
[ "$SRC" = "./.claude/skills/bakers-build" ] || fail "source is not ./.claude/skills/bakers-build (got $SRC)"
[ -d "$SRC/skills" ] || fail "source dir has no skills/ (not the project skill bundle dir)"
[ -f "$SRC/.claude-plugin/plugin.json" ] || fail "source dir carries no plugin manifest"
ok "source ./.claude/skills/bakers-build is the project skill bundle dir"

echo "Scenario: after install the named bakers skills resolve"
# The default recipe and the frame every state runs through: if the bundle layout moves,
# these two break before an installed project silently loses its workflow skills.
[ -f "$SRC/skills/bb-recipe-matt/SKILL.md" ] || fail "skills/bb-recipe-matt/SKILL.md missing"
[ -f "$SRC/skills/bb-workflow/SKILL.md" ] || fail "skills/bb-workflow/SKILL.md missing"
ok "skills/bb-recipe-matt/SKILL.md + skills/bb-workflow/SKILL.md resolve"

echo "Scenario: the shipped skill set is exactly bakers"
# BB-273 narrowed to TWO SHELL SCRIPTS AND THEIR DOCUMENTATION AND NO SKILL: the
# manual skill-testing wiring is `scripts/{setup,teardown}-test-project.sh`, so there
# is no harness skill left to keep out of the marketplace (the automated one moved to
# BB-286). What still needs guarding is the structural claim this scenario is named
# for — one plugin, and no second skill bundle sitting in the same directory that a
# reader would take for a shipped one. Beside it sit only this repository's own
# project skills (one SKILL.md each), which never ship.
[ -d .claude/skills/bakers-build ] || fail ".claude/skills/bakers-build missing"
for d in .claude/skills/*/; do
  [ "$d" = ".claude/skills/bakers-build/" ] && continue
  [ -f "${d}SKILL.md" ] && [ ! -e "${d}.claude-plugin" ] && [ ! -d "${d}skills" ] \
    || fail "$d is a second skill bundle, not a project skill"
done
ok "bakers-build is the only skill bundle, and it is the one the marketplace ships"

echo "ALL SCENARIOS GREEN"
