#!/usr/bin/env python3
"""Reconcile designbook/data-model.yml + designbook/data/*.yml against the code.

BB-328. Run from anywhere:

    python3 scripts/check-designbook-data-model.py

The repository root is derived from this file's own location, so the script
carries no absolute path and works in any worktree.

Sections printed, always in this order:

    S0  declaration sources     what was read, and from where
    V1  parse + record shape    schema shape, id uniqueness, enums, datetimes
    V2  declared - modelled     a coded field that the model does not carry
    V2R modelled - declared     a modelled field that no code declares
    V3  sample data             one file per bundle, references resolve
    V4  tenancy isolation       two tenants, disjoint, non-empty, no leak
    NOT MECHANICALLY CHECKED    bundles no ref in this repo can supply

Exit 0 only when every section passes; the last line is RESULT: PASS or
RESULT: FAIL.

Design notes — the three things an earlier throwaway version got wrong:

1.  The class list is DERIVED, not hardcoded. Every
    `bb_core/src/Entity/*.php` is globbed, `*Interface.php` and the abstract
    base are skipped, and the entity type id is read out of the
    `#[ContentEntityType(` / `#[ConfigEntityType(` attribute. Adding an entity
    class to bb_core therefore fails this gate until the model catches up,
    instead of being silently invisible.

2.  The hook-added base fields are PARSED, not copy-pasted. Every
    `hook_entity_base_field_info()` implementation in `web/modules/custom` is
    located and its body read in one of the two shapes Drupal code uses: the
    early-return guard (`if ($entity_type->id() !== 'x') { return []; }`) and
    the per-type block (`if ($entity_type->id() === 'x') { ... }`). This is the
    choice requirement 3 of the ticket offers first. It is preferred over a
    literal snapshot table because a table drifts silently, and it is safe to
    prefer here because the parser FAILS LOUDLY rather than under-reporting: a
    hook body it cannot attribute to an entity type, a `$fields['x']` outside
    any recognised block, or a hook that yields no fields at all is reported as
    a hard failure naming the file. A snapshot could only ever notice drift it
    was told to look for; this notices drift it has never seen.

3.  Loop-defined fields are resolved. `BbRun` defines its six footprint
    fields as `$fields[$name]` inside a `foreach` over an array literal, so a
    grep for `$fields['...']` under-reports by six. Any unresolvable
    `$fields[$var]` is a hard failure, never a silent skip.

5.  AC5's second half is measured, not eyeballed. V3 proves references
    RESOLVE; it is silent on whether the two tenants are isolated, which is
    the whole point of a two-workspace fixture and was previously checked by
    hand. V4 derives the tenancy spine from the model's own reference graph —
    it hardcodes no hop, so a renamed or added link re-derives rather than
    bypasses — and then asserts that people are disjoint, that no workspace is
    empty, that no record names a person its own tenant cannot see, and that
    bb_project.members agrees with the og_membership rows. Where two equally
    short routes to a tenant exist (a run reaches one through its ticket and
    through its conductor), they must agree; a disagreement is reported rather
    than resolved by an invented tie-break.

And the fourth: bundles with no class in this worktree are not skipped in
silence. `bb_workspace` is read from `origin/feat/bb-315-multi-workspace`
with `git show`, and `og.og_role` from that same ref's `config/sync/og.og_role.*.yml`,
so both are checked in BOTH directions. `bb_team` and `og_membership` are
reachable at no ref of this repository; they are printed by name, with the
source each was hand-verified against, in the NOT MECHANICALLY CHECKED section.
That section never fails the run, but it always prints, so the exemption is
visible rather than silent.
"""

from __future__ import annotations

import datetime as _dt
import pathlib
import re
import subprocess
import sys

import yaml

ROOT = pathlib.Path(__file__).resolve().parent.parent
DB = ROOT / "web/themes/custom/bb_theme/designbook"
CUSTOM = ROOT / "web/modules/custom"
ENT = CUSTOM / "bb_core/src/Entity"

# The branch that carries the tenancy backend. Not merged to develop, so the
# classes and config it holds are absent from this worktree's checkout.
TENANCY_REF = "origin/feat/bb-315-multi-workspace"

# Entity keys. Never modelled as fields, and never reported in either
# direction: they are addressing, not content.
ENTITY_KEYS = {"id", "uuid", "langcode", "default_langcode", "revision_id", "vid", "type"}

# Config-object metadata every config entity carries. Excluded for the same
# reason as ENTITY_KEYS: it is storage bookkeeping, not a modelled key.
CONFIG_META = {"uuid", "langcode", "status", "dependencies", "_core"}

# The one reserved key under the model's `config:` root. Everything else there
# is a config entity type keyed by its Drupal config-name prefix; this key maps
# config-name prefix -> the reason that type is deliberately not modelled. It
# is the config-level twin of a bundle's `omitted:` map (spec D4) and is read
# by V2 exactly as that one is.
CONFIG_OMITTED_KEY = "omitted"

# Entity types whose declaration source is only PARTIAL here, so the reverse
# direction cannot run on them. The forward direction still does, against what
# is visible. Printed every run, with the reason.
PARTIAL_SOURCES = {
    "user": (
        "the base fields live in Drupal core's User::baseFieldDefinitions(); "
        "web/core is not vendored in this checkout (no composer install), so "
        "none of them is mechanically visible. Verified by hand against the "
        "Drupal 11 user entity."
    ),
}

# Bundles no ref of this repository can supply, with the source each was
# hand-verified against. Printed every run; never a failure.
UNCHECKABLE = {
    "bb_team": (
        "BB-321 (qualification) — decided but unbuilt: bb_team is name, "
        "workspace_id, owner_user_id, an OG group granted no OG permissions. "
        "No BbTeam.php exists at any ref of this repository."
    ),
    "og_membership": (
        "contrib OG 2.x OgMembership::baseFieldDefinitions(), read at "
        "web/modules/contrib/og/src/Entity/OgMembership.php in the "
        "feat/bb-318-bridge-og-member worktree. og is not vendored here "
        "(no composer install), so no ref of this repository holds it."
    ),
}

# ---- V4 anchors ----------------------------------------------------------
# Three anchors, and only three. Each is a schema FACT, not a fixture
# convention: the workspace is what a tenant IS (BB-316), og_membership is
# where membership lives and the only place it lives (spec Fact 21), and
# `user` is who a person is. Everything else V4 needs — above all WHICH FIELDS
# hop from a ticket to its tenant — is DERIVED from the model's own reference
# graph, so renaming a hop, adding a shortcut such as a future
# bb_project.workspace_id, or dropping one re-derives the spine rather than
# silently bypassing the check.
TENANCY_ROOT = "bb_workspace"
MEMBERSHIP = "og_membership"
PERSON = "user"

# Every workspace must reach at least one record of each of these. The
# workspace switcher is one of the two cross-cutting controls in the spec's
# AC6 walk, and a fixture built to prove isolation has to give it something to
# switch TO — an empty second tenant demonstrates nothing, which is exactly
# the defect the review found.
TENANT_MUST_REACH = ("bb_ticket", "bb_run", "bb_comment")

# The keys V4 reads off a membership row. Named so that a rename fails loudly
# here instead of quietly yielding zero memberships and a green run: V2/V2R
# cannot cover og_membership (R8), so this is its only guard.
MEMBERSHIP_KEYS = ("uid", "entity_type", "entity_id", "state")
MEMBERSHIP_ACTIVE = "active"

FAILURES: list[str] = []


def hard_fail(section: str, message: str) -> None:
    """Record a failure that means the gate itself could not do its job."""
    FAILURES.append(f"{section}: {message}")


def read_at_ref(path: str) -> str:
    """Read a repository path at TENANCY_REF. A miss is a hard failure."""
    try:
        return subprocess.run(
            ["git", "show", f"{TENANCY_REF}:{path}"],
            cwd=ROOT,
            check=True,
            capture_output=True,
            text=True,
        ).stdout
    except subprocess.CalledProcessError as exc:  # pragma: no cover - env issue
        raise SystemExit(
            f"cannot read {path} at {TENANCY_REF}: {exc.stderr.strip()}\n"
            f"Fetch the ref ('git fetch origin {TENANCY_REF.split('/', 1)[1]}') "
            f"and re-run; this gate refuses to skip it silently."
        ) from exc


# --------------------------------------------------------------------------
# Declaration sources
# --------------------------------------------------------------------------

ATTR_RE = re.compile(r"#\[(ContentEntityType|ConfigEntityType)\((.*?)^\)\]", re.S | re.M)
LITERAL_FIELD_RE = re.compile(r"\$fields\['([a-z0-9_]+)'\]")
VARIABLE_FIELD_RE = re.compile(r"\$fields\[\$([a-zA-Z_][a-zA-Z0-9_]*)\]")


def _block(src: str, open_index: int) -> str:
    """Return the brace-balanced block that starts at the '{' at open_index."""
    depth = 0
    for i in range(open_index, len(src)):
        if src[i] == "{":
            depth += 1
        elif src[i] == "}":
            depth -= 1
            if depth == 0:
                return src[open_index : i + 1]
    return src[open_index:]


def _array_literal_keys(src: str, var: str) -> tuple[list[str], list[str]]:
    """Return (keys, values) of the array literal assigned to $<var>."""
    m = re.search(rf"\${re.escape(var)}\s*=\s*\[", src)
    if not m:
        return [], []
    body = _bracket_body(src, m.end() - 1)
    keys = re.findall(r"'([a-z0-9_]+)'\s*=>", body)
    values = re.findall(r"=>\s*'([a-z0-9_]+)'", body) or re.findall(r"'([a-z0-9_]+)'", body)
    return keys, values


def _bracket_body(src: str, open_index: int) -> str:
    depth = 0
    for i in range(open_index, len(src)):
        if src[i] == "[":
            depth += 1
        elif src[i] == "]":
            depth -= 1
            if depth == 0:
                return src[open_index + 1 : i]
    return src[open_index:]


def loop_fields(src: str, where: str) -> set[str]:
    """Resolve every `$fields[$var]` to the names its foreach really writes.

    An unresolvable one is a hard failure — the case this exists to prevent is
    exactly a silent under-report (BbRun's six footprint fields).
    """
    names: set[str] = set()
    unresolved = set(VARIABLE_FIELD_RE.findall(src))
    if not unresolved:
        return names
    for m in re.finditer(
        r"foreach\s*\(\s*\$([A-Za-z_]\w*)\s+as\s+(?:\$([A-Za-z_]\w*)\s*=>\s*)?\$([A-Za-z_]\w*)\s*\)\s*\{",
        src,
    ):
        arr, keyvar, valvar = m.group(1), m.group(2), m.group(3)
        body = _block(src, m.end() - 1)
        used = set(VARIABLE_FIELD_RE.findall(body))
        keys, values = _array_literal_keys(src, arr)
        if keyvar and keyvar in used:
            if not keys:
                hard_fail("V2", f"{where}: cannot resolve the array ${arr} of a $fields[${keyvar}] loop")
            names |= set(keys)
            unresolved.discard(keyvar)
        if valvar in used:
            pool = values if not keyvar else values
            if not pool:
                hard_fail("V2", f"{where}: cannot resolve the array ${arr} of a $fields[${valvar}] loop")
            names |= set(pool)
            unresolved.discard(valvar)
    for var in sorted(unresolved):
        hard_fail("V2", f"{where}: $fields[${var}] is written outside any resolvable foreach")
    return names


def parse_entity_class(path: pathlib.Path, src: str) -> dict | None:
    """Read one entity class into {kind, etype, fields, provider, prefix}."""
    m = ATTR_RE.search(src)
    if not m:
        return None
    kind, attr = m.group(1), m.group(2)
    idm = re.search(r"^\s*id:\s*'([a-z0-9_]+)'", attr, re.M)
    if not idm:
        return None
    etype = idm.group(1)
    provider = path.parents[2].name  # …/<module>/src/Entity/X.php
    if kind == "ConfigEntityType":
        prefix = re.search(r"config_prefix:\s*'([a-z0-9_]+)'", attr)
        exports = re.search(r"config_export:\s*\[(.*?)\]", attr, re.S)
        fields = set(re.findall(r"'([a-z0-9_]+)'", exports.group(1))) if exports else set()
        return {
            "kind": "config",
            "etype": etype,
            "fields": fields,
            "config_name": f"{provider}.{prefix.group(1)}" if prefix else f"{provider}.{etype}",
        }
    fields = set(LITERAL_FIELD_RE.findall(src)) | loop_fields(src, path.name)
    if re.search(r"class\s+\w+\s+extends\s+BbContentEntityBase\b", src):
        fields |= {"created", "changed"}
    return {"kind": "content", "etype": etype, "fields": fields}


def discover_classes() -> tuple[dict[str, set[str]], dict[str, set[str]], list[str]]:
    """Glob the entity directory. Returns (content, config, source lines)."""
    content: dict[str, set[str]] = {}
    config: dict[str, set[str]] = {}
    seen: list[str] = []
    for path in sorted(ENT.glob("*.php")):
        if path.name.endswith("Interface.php") or path.name == "BbContentEntityBase.php":
            continue
        parsed = parse_entity_class(path, path.read_text())
        if parsed is None:
            continue  # no entity-type attribute: a bundle class.
        if parsed["kind"] == "content":
            content[parsed["etype"]] = parsed["fields"]
            seen.append(f"{path.name} -> content {parsed['etype']} ({len(parsed['fields'])} fields)")
        else:
            config[parsed["config_name"]] = parsed["fields"]
            seen.append(f"{path.name} -> config {parsed['config_name']} ({len(parsed['fields'])} keys)")
    return content, config, seen


def parse_hook(path: pathlib.Path) -> dict[str, set[str]]:
    """Parse one hook_entity_base_field_info() into {entity_type: fields}."""
    src = path.read_text()
    m = re.search(r"function\s+\w+_entity_base_field_info\s*\([^)]*\)\s*:?\s*\w*\s*\{", src)
    if not m:
        return {}
    body = _block(src, m.end() - 1)
    out: dict[str, set[str]] = {}

    guard = re.search(r"\$entity_type->id\(\)\s*!==\s*'([a-z0-9_]+)'", body)
    blocks = list(re.finditer(r"if\s*\(\s*\$entity_type->id\(\)\s*===\s*'([a-z0-9_]+)'\s*\)\s*\{", body))

    if guard and not blocks:
        names = set(LITERAL_FIELD_RE.findall(body)) | loop_fields(body, path.name)
        out[guard.group(1)] = names - ENTITY_KEYS
    elif blocks:
        covered = 0
        for b in blocks:
            block = _block(body, b.end() - 1)
            covered += len(LITERAL_FIELD_RE.findall(block))
            names = set(LITERAL_FIELD_RE.findall(block)) | loop_fields(block, path.name)
            out.setdefault(b.group(1), set()).update(names - ENTITY_KEYS)
        total = len(LITERAL_FIELD_RE.findall(body))
        if covered != total:
            hard_fail(
                "V2",
                f"{path.name}: {total - covered} $fields[...] assignment(s) sit outside any "
                f"`if ($entity_type->id() === '…')` block; the parser refuses to guess their owner",
            )
    else:
        hard_fail(
            "V2",
            f"{path.name}: hook_entity_base_field_info() matches neither the guard nor the "
            f"per-type block shape; the parser cannot attribute its fields",
        )
        return {}

    if not any(out.values()):
        hard_fail("V2", f"{path.name}: hook_entity_base_field_info() parsed to zero fields")
    return out


def discover_hooks() -> tuple[dict[str, set[str]], list[str]]:
    """Find and parse every custom hook_entity_base_field_info()."""
    hooks: dict[str, set[str]] = {}
    seen: list[str] = []
    files = sorted(
        p
        for p in CUSTOM.rglob("*.module")
        if "_entity_base_field_info" in p.read_text()
    )
    if not files:
        hard_fail("V2", "no hook_entity_base_field_info() implementation found under web/modules/custom")
    for path in files:
        parsed = parse_hook(path)
        for etype, names in parsed.items():
            hooks.setdefault(etype, set()).update(names)
        summary = ", ".join(f"{e} +{len(n)}" for e, n in sorted(parsed.items()))
        seen.append(f"{path.relative_to(ROOT)} -> {summary or '(nothing)'}")
    return hooks, seen


def branch_sources() -> tuple[dict[str, set[str]], dict[str, set[str]], list[str]]:
    """Read the tenancy backend from TENANCY_REF: BbWorkspace + og_role."""
    content: dict[str, set[str]] = {}
    config: dict[str, set[str]] = {}
    seen: list[str] = []

    base = "web/modules/custom/bb_core/src/Entity"
    listing = subprocess.run(
        ["git", "ls-tree", "--name-only", TENANCY_REF, f"{base}/"],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.split()
    for rel in sorted(listing):
        name = rel.rsplit("/", 1)[-1]
        if name.endswith("Interface.php") or name == "BbContentEntityBase.php":
            continue
        parsed = parse_entity_class(pathlib.Path(ROOT / rel), read_at_ref(rel))
        if parsed and parsed["kind"] == "content":
            content[parsed["etype"]] = parsed["fields"]
    seen.append(
        f"{TENANCY_REF}:{base}/*.php -> {len(content)} content entity types "
        f"(the tenancy backend; only types absent from this worktree are new)"
    )

    roles = subprocess.run(
        ["git", "ls-tree", "--name-only", TENANCY_REF, "config/sync/"],
        cwd=ROOT,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.split()
    role_files = sorted(r for r in roles if r.rsplit("/", 1)[-1].startswith("og.og_role."))
    if not role_files:
        hard_fail("V2", f"no og.og_role.* config found at {TENANCY_REF}")
    keys: set[str] = set()
    for rel in role_files:
        keys |= set(yaml.safe_load(read_at_ref(rel)) or {})
    config["og.og_role"] = keys - CONFIG_META
    seen.append(
        f"{TENANCY_REF}:config/sync/og.og_role.*.yml -> config og.og_role "
        f"({len(role_files)} objects, {len(config['og.og_role'])} keys)"
    )
    return content, config, seen


# --------------------------------------------------------------------------
# The model and the sample data
# --------------------------------------------------------------------------


def field_defs(defn: dict) -> dict:
    return defn.get("fields") or {}


def modelled_names(defn: dict) -> set[str]:
    return set(field_defs(defn)) | set(defn.get("omitted") or {})


def iso_ok(value) -> bool:
    if not isinstance(value, str):
        # PyYAML resolves an unquoted timestamp to a date/datetime itself.
        return isinstance(value, (_dt.date, _dt.datetime))
    try:
        _dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return False
    return True


def reference_graph(content_model: dict) -> dict[str, dict[str, str]]:
    """entity type -> {field: target entity type}, single-valued refs only.

    Single-valued because only a single-valued reference can express "this
    record BELONGS TO that one". A multi-valued one (labels, blocked_by,
    environments, members) is an association, and following it would make a
    record's tenant ambiguous by construction.
    """
    graph: dict[str, dict[str, str]] = {}
    for etype, bundles in content_model.items():
        edges = graph.setdefault(etype, {})
        for defn in bundles.values():
            for fname, fdef in field_defs(defn).items():
                if fdef.get("type") != "reference" or "reference" not in fdef:
                    continue
                if fdef.get("multiple"):
                    continue
                edges[fname] = fdef["reference"]
    return graph


def tenancy_paths(graph: dict[str, dict[str, str]], start: str, root: str) -> list[list[str]]:
    """Every SHORTEST field path from `start` to `root`, breadth-first.

    All shortest paths, not one: where two equally short routes exist — a run
    reaches its tenant through its ticket AND through its conductor — they
    must agree, and a disagreement is itself a tenancy defect V4 reports. That
    is why no arbitrary tie-break is invented here.
    """
    if start == root:
        return [[]]
    frontier: list[tuple[str, list[str]]] = [(start, [])]
    seen = {start}
    while frontier:
        nxt: list[tuple[str, list[str]]] = []
        found: list[list[str]] = []
        for etype, path in frontier:
            for fname, target in sorted(graph.get(etype, {}).items()):
                if target == root:
                    found.append(path + [fname])
                elif target not in seen:
                    nxt.append((target, path + [fname]))
        if found:
            return found
        seen |= {e for e, _ in nxt}
        frontier = nxt
    return []


def follow_path(
    graph: dict[str, dict[str, str]],
    by_type: dict[str, dict[str, dict]],
    etype: str,
    rec: dict,
    path: list[str],
) -> str | None:
    """Walk one derived path from a record to a tenancy-root record id."""
    cur, cur_type = rec, etype
    for fname in path:
        value = cur.get(fname)
        if value in (None, ""):
            return None
        target_type = graph.get(cur_type, {}).get(fname)
        if target_type is None:
            return None
        cur = by_type.get(target_type, {}).get(str(value))
        if cur is None:
            return None
        cur_type = target_type
    return str(cur.get("id")) if cur.get("id") is not None else None


def allowed_set(settings: dict) -> set[str] | None:
    if not isinstance(settings, dict) or "allowed_values" not in settings:
        return None
    values = settings["allowed_values"]
    if isinstance(values, dict):
        return {str(k) for k in values}
    if isinstance(values, list):
        return {str(v) for v in values}
    return None


def main() -> int:
    model = yaml.safe_load((DB / "data-model.yml").read_text())
    content_model = model.get("content") or {}
    # `omitted` under `config:` is a RESERVED key, not a config object: it is
    # the config-level twin of a bundle's own `omitted:` map (D4), keyed by
    # config-name prefix, naming a config entity type this model deliberately
    # does not carry. Split out here once, so every later section sees only
    # real config entries. The mechanism is general — no config name is
    # hardcoded anywhere in this script.
    config_root = model.get("config") or {}
    config_omitted = config_root.get(CONFIG_OMITTED_KEY) or {}
    config_model = {k: v for k, v in config_root.items() if k != CONFIG_OMITTED_KEY}

    class_content, class_config, class_src = discover_classes()
    hook_fields, hook_src = discover_hooks()
    ref_content, ref_config, ref_src = branch_sources()

    # Declared = this worktree's classes + hooks, unioned with the tenancy
    # branch. The union is deliberate: a field the tenancy branch adds to an
    # entity type that already exists here (bb_group.workspace_id) is real
    # and the model must carry it, and one it removes (bb_project.members)
    # is still real on develop, which is the code this worktree runs.
    declared: dict[str, set[str]] = {}
    for pool in (class_content, ref_content):
        for etype, names in pool.items():
            declared.setdefault(etype, set()).update(names)
    for etype, names in hook_fields.items():
        declared.setdefault(etype, set()).update(names)
    for etype in declared:
        declared[etype] -= ENTITY_KEYS

    declared_config: dict[str, set[str]] = {}
    for pool in (class_config, ref_config):
        for name, keys in pool.items():
            declared_config.setdefault(name, set()).update(keys)

    # Which model bundle carries which entity type's declaration. A content
    # entity type with several bundles (bb_term) shares one declaration.
    print("S0 declaration sources")
    for line in class_src + hook_src + ref_src:
        print(f"  {line}")

    problems = 0

    # ---- V1 -------------------------------------------------------------
    print("\nV1 parse + record shape")
    bad: list[str] = []
    if not isinstance(model, dict) or "content" not in model:
        bad.append("data-model.yml has no top-level 'content' key")
    for etype, bundles in content_model.items():
        for bundle, defn in bundles.items():
            for fname, fdef in field_defs(defn).items():
                if not isinstance(fdef, dict) or "type" not in fdef:
                    bad.append(f"{etype}.{bundle}.{fname} has no 'type'")
    # The reserved config-level `omitted:` map is checked as itself, not as a
    # config object: its KEYS must be config-name prefixes and each must carry
    # a non-empty reason, so an entry cannot silence V2 without saying why.
    for cname, reason in config_omitted.items():
        if not re.fullmatch(r"[a-z0-9_]+(\.[a-z0-9_]+)+", cname):
            bad.append(
                f"config.omitted key '{cname}' is not a Drupal config-name prefix "
                f"(^[a-z0-9_]+(\\.[a-z0-9_]+)+$)"
            )
        if not isinstance(reason, str) or not reason.strip():
            bad.append(f"config.omitted['{cname}'] has no reason; an omission must state why")
    for cname, defn in config_model.items():
        if not re.fullmatch(r"[a-z0-9_]+(\.[a-z0-9_]+)+", cname):
            bad.append(
                f"config key '{cname}' is not a Drupal config-name prefix "
                f"(^[a-z0-9_]+(\\.[a-z0-9_]+)+$)"
            )
        if "entity_type" not in defn:
            bad.append(f"config.{cname} does not name its 'entity_type'")
        for fname, fdef in field_defs(defn).items():
            if not isinstance(fdef, dict) or "type" not in fdef:
                bad.append(f"config.{cname}.{fname} has no 'type'")

    data_files = sorted((DB / "data").glob("*.yml"))
    records: dict[str, list[dict]] = {}
    for path in data_files:
        recs = yaml.safe_load(path.read_text())
        if not isinstance(recs, list):
            bad.append(f"{path.name} is not a record array")
            continue
        records[path.stem] = recs
        for n, rec in enumerate(recs):
            if "id" not in rec:
                bad.append(f"{path.name}[{n}] has no 'id'")
            if "section" not in (rec.get("__designbook") or {}):
                bad.append(f"{path.name}[{n}] has no __designbook.section")

    # id uniqueness is PER ENTITY TYPE, not per file: bb_term is one entity
    # type whose two bundle files share a single id space, which is how a
    # 1,2,3 collision got in.
    per_type: dict[str, dict[str, str]] = {}
    for stem, recs in records.items():
        etype = stem.split(".")[0]
        for rec in recs:
            rid = str(rec.get("id"))
            first = per_type.setdefault(etype, {})
            if rid in first:
                bad.append(
                    f"{etype}: id '{rid}' is used by both {first[rid]}.yml and {stem}.yml — "
                    f"one entity type, one id space"
                )
            else:
                first[rid] = stem

    # Enum + datetime validation against the modelled field definitions.
    def bundle_defs():
        for etype, bundles in content_model.items():
            for bundle, defn in bundles.items():
                yield f"{etype}.{bundle}", defn
        for cname, defn in config_model.items():
            yield f"{defn.get('entity_type', cname)}.{defn.get('entity_type', cname)}", defn

    for stem, defn in bundle_defs():
        for rec in records.get(stem, []):
            for fname, fdef in field_defs(defn).items():
                if fname not in rec or rec[fname] in (None, []):
                    continue
                values = rec[fname] if isinstance(rec[fname], list) else [rec[fname]]
                allowed = allowed_set(fdef.get("settings"))
                if allowed is not None:
                    for v in values:
                        if str(v) not in allowed:
                            bad.append(
                                f"{stem}[{rec['id']}].{fname} = {v!r} is not in "
                                f"allowed_values {sorted(allowed)}"
                            )
                if fdef.get("type") == "datetime":
                    for v in values:
                        if not iso_ok(v):
                            bad.append(
                                f"{stem}[{rec['id']}].{fname} = {v!r} is not an ISO-8601 datetime"
                            )
    if bad:
        print(f"  FAIL V1: {len(bad)}")
        for item in bad:
            print(f"    - {item}")
        problems += 1
    else:
        print(
            f"  OK  model parses; {len(data_files)} sample-data files well-formed; "
            f"ids unique per entity type; enum and datetime values valid"
        )

    # ---- V2 forward: declared - modelled --------------------------------
    print("\nV2 declared - modelled (a coded field the model does not carry)")
    missing: list[str] = []
    config_omissions: list[str] = []
    for etype, names in sorted(declared.items()):
        bundles = content_model.get(etype) or {}
        if not bundles:
            missing.append(f"{etype}: entity type absent from the model ({len(names)} fields)")
            continue
        for bundle, defn in bundles.items():
            have = modelled_names(defn)
            for f in sorted(names - have):
                missing.append(f"{etype}.{bundle}.{f}")
    for cname, keys in sorted(declared_config.items()):
        defn = config_model.get(cname)
        if defn is None:
            # Absent is a failure UNLESS the model says so on purpose, in the
            # reserved config-level `omitted:` map — the same contract a field
            # gets from its bundle's `omitted:` map.
            if cname in config_omitted:
                config_omissions.append(f"config {cname} — {config_omitted[cname]}")
                continue
            missing.append(f"config {cname}: absent from the model ({len(keys)} keys)")
            continue
        have = modelled_names(defn)
        for k in sorted(keys - have):
            missing.append(f"config {cname}.{k}")
    if missing:
        print(f"  FAIL V2: {len(missing)}")
        for item in missing:
            print(f"    - {item}")
        problems += 1
    else:
        print("  OK  every declared field is modelled or stated as omitted")
    if config_omissions:
        print(f"  config entity types deliberately not modelled: {len(config_omissions)}")
        for item in config_omissions:
            print(f"    - {item}")

    # ---- V2R reverse: modelled - declared -------------------------------
    print("\nV2R modelled - declared (a modelled field no code declares)")
    invented: list[str] = []
    design_ahead: list[str] = []
    unchecked_bundles: dict[str, str] = {}
    # The reverse direction needs a COMPLETE declaration source, which only an
    # entity class is: a hook adds fields, it never enumerates them all. So an
    # entity type known here through a hook alone (user) is reverse-exempt and
    # said to be, rather than reported as eleven inventions.
    class_backed = set(class_content) | set(ref_content)
    for etype, bundles in sorted(content_model.items()):
        for bundle, defn in bundles.items():
            if etype not in class_backed:
                unchecked_bundles[f"{etype}.{bundle}"] = PARTIAL_SOURCES.get(
                    etype,
                    UNCHECKABLE.get(etype, "no class declares this entity type at any ref"),
                )
                continue
            for fname, fdef in sorted(field_defs(defn).items()):
                if fname in ENTITY_KEYS or fname in declared[etype]:
                    continue
                marker = fdef.get("design_ahead")
                if marker:
                    design_ahead.append(f"{etype}.{bundle}.{fname} -> {marker}")
                else:
                    invented.append(f"{etype}.{bundle}.{fname} is declared by no class and no hook")
    for cname, defn in sorted(config_model.items()):
        keys = declared_config.get(cname)
        if keys is None:
            unchecked_bundles[f"config {cname}"] = "no shipped config object declares this key set"
            continue
        for fname, fdef in sorted(field_defs(defn).items()):
            if fname in keys:
                continue
            marker = fdef.get("design_ahead")
            if marker:
                design_ahead.append(f"config {cname}.{fname} -> {marker}")
            else:
                invented.append(f"config {cname}.{fname} is declared by no shipped config object")
    if invented:
        print(f"  FAIL V2R: {len(invented)}")
        for item in invented:
            print(f"    - {item}")
        problems += 1
    else:
        print("  OK  every modelled field is declared, or carries a design_ahead pointer")
    if design_ahead:
        print(f"  design-ahead, exempt by an in-model pointer: {len(design_ahead)}")
        for item in design_ahead:
            print(f"    - {item}")

    # ---- V3 sample data --------------------------------------------------
    print("\nV3 sample data")
    v3: list[str] = []
    notes: list[str] = []
    ids_by_type: dict[str, set[str]] = {}
    bundles_by_type: dict[str, list[str]] = {}
    for stem, recs in records.items():
        etype = stem.split(".")[0]
        ids_by_type.setdefault(etype, set()).update(str(r["id"]) for r in recs if "id" in r)
        bundles_by_type.setdefault(etype, []).append(stem)

    for stem, defn in bundle_defs():
        if stem not in records:
            v3.append(f"no sample data: data/{stem}.yml")
            continue
        refs = {
            n: d["reference"]
            for n, d in field_defs(defn).items()
            if d.get("type") == "reference" and "reference" in d
        }
        for rec in records[stem]:
            for fname, target in refs.items():
                values = rec.get(fname)
                if values in (None, []):
                    continue
                if "." in target:  # the model named a bundle: data/<target>.yml
                    pool = {str(r["id"]) for r in records.get(target, [])}
                    scope = f"bundle {target}"
                else:
                    pool = ids_by_type.get(target, set())
                    scope = f"entity type {target}"
                    if len(bundles_by_type.get(target, [])) > 1:
                        note = (
                            f"{target}: the model names an entity type, not a bundle, so "
                            f"references resolve against the union of "
                            f"{', '.join(sorted(bundles_by_type[target]))}"
                        )
                        if note not in notes:
                            notes.append(note)
                for v in values if isinstance(values, list) else [values]:
                    if str(v) not in pool:
                        v3.append(f"{stem}[{rec['id']}].{fname} -> {scope}/{v} does not exist")

    # Polymorphic membership targets: entity_id is a bare string whose entity
    # type is named by the sibling entity_type field, so no `reference:` can
    # express it. Checked here because it is exactly the dangling reference a
    # two-workspace fixture gets wrong.
    for stem, recs in records.items():
        for rec in recs:
            target_type = rec.get("entity_type")
            target_id = rec.get("entity_id")
            if not target_type or target_id in (None, ""):
                continue
            pool = ids_by_type.get(str(target_type))
            if pool is None:
                v3.append(
                    f"{stem}[{rec['id']}].entity_type = {target_type!r} has no sample data at all"
                )
            elif str(target_id) not in pool:
                v3.append(
                    f"{stem}[{rec['id']}] -> {target_type}/{target_id} does not exist "
                    f"(polymorphic entity_type/entity_id pair)"
                )

    if v3:
        print(f"  FAIL V3: {len(v3)}")
        for item in v3:
            print(f"    - {item}")
        problems += 1
    else:
        print("  OK  every bundle has sample data and every reference resolves")
    for note in notes:
        print(f"  note: {note}")

    # ---- V4 tenancy isolation --------------------------------------------
    # AC5's second half. V3 proves references RESOLVE; it says nothing about
    # whether the two tenants are actually isolated, which is what the fixture
    # exists to demonstrate and what the review checked by hand.
    print("\nV4 tenancy isolation")
    v4: list[str] = []
    v4_notes: list[str] = []

    graph = reference_graph(content_model)
    by_type: dict[str, dict[str, dict]] = {}
    for stem, recs in records.items():
        etype = stem.split(".")[0]
        for rec in recs:
            if "id" in rec:
                by_type.setdefault(etype, {})[str(rec["id"])] = rec

    workspaces = by_type.get(TENANCY_ROOT, {})
    if not workspaces:
        v4.append(f"no {TENANCY_ROOT} sample data: tenancy isolation cannot be measured at all")

    # The spine, derived. Printed so the derivation is auditable rather than
    # taken on trust — the same reason S0 names its declaration sources.
    paths_by_type: dict[str, list[list[str]]] = {}
    for etype in sorted(by_type):
        if etype == MEMBERSHIP:
            continue  # its group link is a string pair, not a reference; see below
        found = tenancy_paths(graph, etype, TENANCY_ROOT)
        if found:
            paths_by_type[etype] = found
    print("  spine derived from the model's reference graph:")
    for etype in sorted(paths_by_type):
        routes = " | ".join(".".join(p) or "(is the root)" for p in paths_by_type[etype])
        print(f"    {etype} -> {routes}")

    # Membership index. og_membership links to its group through the string
    # pair entity_type/entity_id, which no `reference:` can express, so this is
    # the one hop V4 reads by name — guarded so a rename fails loudly instead
    # of yielding zero memberships and a green run.
    member_recs = [r for stem, recs in records.items() if stem.split(".")[0] == MEMBERSHIP for r in recs]
    if not member_recs:
        v4.append(f"no {MEMBERSHIP} sample data: membership cannot be measured")
    for rec in member_recs:
        missing_keys = [k for k in MEMBERSHIP_KEYS if k not in rec]
        if missing_keys:
            v4.append(
                f"{MEMBERSHIP}[{rec.get('id')}] has no {', '.join(missing_keys)} — "
                f"V4 reads these keys by name and refuses to guess"
            )

    ws_of_user: dict[str, set[str]] = {}
    proj_members: dict[str, set[str]] = {}
    for rec in member_recs:
        if str(rec.get("state")) != MEMBERSHIP_ACTIVE:
            continue
        uid, gtype, gid = str(rec.get("uid")), str(rec.get("entity_type")), str(rec.get("entity_id"))
        if gtype == TENANCY_ROOT:
            ws_of_user.setdefault(uid, set()).add(gid)
        elif gtype == "bb_project":
            proj_members.setdefault(gid, set()).add(uid)

    # Resolve every record's tenant once, and report a record whose two
    # equally short routes disagree.
    tenant_of: dict[tuple[str, str], str] = {}
    unresolved: dict[str, int] = {}
    for etype, paths in sorted(paths_by_type.items()):
        for rid, rec in sorted(by_type.get(etype, {}).items()):
            reached = {follow_path(graph, by_type, etype, rec, p) for p in paths}
            reached.discard(None)
            if not reached:
                unresolved[etype] = unresolved.get(etype, 0) + 1
                continue
            if len(reached) > 1:
                routes = ", ".join(".".join(p) for p in paths)
                v4.append(
                    f"{etype}[{rid}] reaches {sorted(reached)} — its equally short routes "
                    f"({routes}) disagree about which tenant owns it"
                )
                continue
            tenant_of[(etype, rid)] = reached.pop()

    # 1. People are disjoint: no user is an active member of two workspaces.
    for uid, wss in sorted(ws_of_user.items()):
        if len(wss) > 1:
            v4.append(
                f"user {uid} holds an active {TENANCY_ROOT} membership in {sorted(wss)} — "
                f"the two tenants must have disjoint people"
            )

    # 2. No workspace is empty: each must reach a ticket, a run and a comment.
    for wsid in sorted(workspaces):
        for etype in TENANT_MUST_REACH:
            n = sum(1 for (et, _), w in tenant_of.items() if et == etype and w == wsid)
            if n == 0:
                v4.append(
                    f"{TENANCY_ROOT} {wsid} ({workspaces[wsid].get('name')}) reaches no {etype} — "
                    f"selecting it in the workspace switcher would show an empty screen"
                )

    # 3. No cross-tenant leak: every person a record names must hold an active
    #    membership in that record's own tenant. This is the generalisation of
    #    the conductor-2 defect the review found, over EVERY user reference the
    #    model declares rather than over the four fields that were wrong.
    for etype in sorted(paths_by_type):
        person_fields = sorted(
            fname
            for bundles in [content_model.get(etype) or {}]
            for defn in bundles.values()
            for fname, fdef in field_defs(defn).items()
            if fdef.get("type") == "reference" and fdef.get("reference") == PERSON
        )
        for rid, rec in sorted(by_type.get(etype, {}).items()):
            wsid = tenant_of.get((etype, rid))
            if wsid is None:
                continue
            for fname in person_fields:
                values = rec.get(fname)
                if values in (None, []):
                    continue
                for uid in values if isinstance(values, list) else [values]:
                    if wsid not in ws_of_user.get(str(uid), set()):
                        held = sorted(ws_of_user.get(str(uid), set())) or "none"
                        v4.append(
                            f"{etype}[{rid}].{fname} = user {uid}, but that user's active "
                            f"{TENANCY_ROOT} membership is {held}, not {wsid} — "
                            f"a record naming a person its tenant cannot see"
                        )

    # 4. bb_project.members agrees with the og_membership rows.
    #    TEMPORARY BY DESIGN: bb_project.members is removed by BB-317 in
    #    favour of og_membership (D18). When that lands and the field leaves
    #    the model, this check finds no `members` to compare and goes with it —
    #    it exists only for as long as the two mechanisms coexist.
    project_model = (content_model.get("bb_project") or {}).get("bb_project") or {}
    if "members" in field_defs(project_model):
        for rid, rec in sorted(by_type.get("bb_project", {}).items()):
            declared = {str(v) for v in (rec.get("members") or [])}
            rows = proj_members.get(rid, set())
            if declared != rows:
                v4.append(
                    f"bb_project[{rid}].members = {sorted(declared)} but its active "
                    f"{MEMBERSHIP} rows are {sorted(rows)} — the two membership mechanisms "
                    f"disagree while both still exist"
                )

    if v4:
        print(f"  FAIL V4: {len(v4)}")
        for item in v4:
            print(f"    - {item}")
        problems += 1
    else:
        print(
            f"  OK  {len(workspaces)} workspaces: people disjoint, none empty, "
            f"no cross-tenant actor, bb_project.members agrees with {MEMBERSHIP}"
        )
    for etype in sorted(unresolved):
        v4_notes.append(
            f"{etype}: {unresolved[etype]} record(s) reach no {TENANCY_ROOT} "
            f"(the hop field is empty), so they are outside checks 2 and 3"
        )
    v4_notes.append(
        f"{MEMBERSHIP} links to its group through the entity_type/entity_id string pair, "
        f"which no reference: can express, so it is the one hop read by field name"
    )
    for note in v4_notes:
        print(f"  note: {note}")

    # ---- always printed --------------------------------------------------
    print("\nNOT MECHANICALLY CHECKED (no ref of this repository declares these)")
    for name in sorted(UNCHECKABLE):
        print(f"  - {name}: {UNCHECKABLE[name]}")
    for name in sorted(PARTIAL_SOURCES):
        print(f"  - {name} (reverse direction only): {PARTIAL_SOURCES[name]}")
    for stem in sorted(unchecked_bundles):
        print(f"  - model bundle {stem}: reverse check exempt — {unchecked_bundles[stem]}")

    if FAILURES:
        print(f"\nGATE FAILURES: {len(FAILURES)}")
        for item in FAILURES:
            print(f"  - {item}")
        problems += 1

    print("\nRESULT:", "FAIL" if problems else "PASS")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
