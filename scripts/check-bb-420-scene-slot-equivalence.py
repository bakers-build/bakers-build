#!/usr/bin/env python3
"""Prove BB-420 Task 20's scene migration re-indented and did not rewrite.

WHY THIS IS IN THE REPOSITORY AT ALL. Task 20 turned `bb_theme:form`'s four
regions from PROPS into SLOTS, because the create-ticket surface is built by
real Drupal field widgets and a widget renders itself — rendered content cannot
go into a prop. Nine scene nodes across three section files had to be
re-expressed against that contract, and the scenes are AC6's source: a changed
scene is a changed agreement, so "only how they say it, never what they render"
is a claim that has to be checkable rather than asserted. The migration itself
ran once and is gone; this is the part that must outlive it.

WHAT IT CHECKS. It loads the three section files at two git refs, applies the
contract change to the BEFORE tree in memory — `expected()` below is the whole
of the transformation, stated once — and compares that against the AFTER tree
node for node. A node the migration dropped, invented, reordered or retyped
fails here. Comments are deliberately NOT compared: they are prose about the
change and were rewritten with it.

USAGE

    scripts/check-bb-420-scene-slot-equivalence.py <before-ref> <after-ref>

Both refs are required and neither is defaulted, because a hard-coded SHA in a
checked-in script is a fact that rots. For Task 20 the pair is the commit that
introduced the slot contract and its own parent:

    scripts/check-bb-420-scene-slot-equivalence.py 8d853ea0f^ 8d853ea0f

Exit 0 when every `bb_theme:form` node is exactly its stated transformation.
"""

import json
import subprocess
import sys

import yaml

SCENES = [
    "web/themes/custom/bb_theme/designbook/sections/tickets/tickets.section.scenes.yml",
    "web/themes/custom/bb_theme/designbook/sections/projects/projects.section.scenes.yml",
    "web/themes/custom/bb_theme/designbook/sections/settings/settings.section.scenes.yml",
]


def expected(node):
    """The slot form of one prop-form `bb_theme:form` node.

    This function IS the contract change. Everything else in this file is
    plumbing around it.
    """
    props = dict(node.get("props") or {})
    lead = props.pop("lead", None)
    lines = props.pop("lines", None) or []
    pills = props.pop("pills", None) or []
    actions = props.pop("actions", None)
    if props:
        raise AssertionError(f"unexpected leftover props on a form node: {sorted(props)}")

    # A surface of ONE line and nothing else is a bare text line now: `form`'s
    # single-line branch existed only because a macro was not addressable, and
    # `text_line` is.
    if lead is None and not pills and not actions and len(lines) == 1:
        return {"component": "bb_theme:text_line", "props": lines[0]}

    out = {"component": "bb_theme:form", "props": {}, "slots": {}}
    if lead is not None:
        # The lead row can no longer read its own name off the object it is
        # handed, because it is handed markup.
        if lead.get("label"):
            out["props"]["lead_label"] = lead["label"]
        out["slots"]["lead"] = [{
            "component": "bb_theme:property_pill",
            # Grammar 3a's weight is asked for by the pill that carries it.
            "props": {"prominent": True, **lead},
        }]
    if lines:
        out["slots"]["lines"] = [
            {"component": "bb_theme:text_line", "props": p} for p in lines
        ]
    if pills:
        out["slots"]["pills"] = [
            {"component": "bb_theme:property_pill", "props": p} for p in pills
        ]
    return out


def transform(node):
    if isinstance(node, list):
        return [transform(n) for n in node]
    if not isinstance(node, dict):
        return node
    if node.get("component") == "bb_theme:form":
        if not set(node) <= {"component", "props"}:
            raise AssertionError(f"a BEFORE form node carries {sorted(node)}")
        return expected(node)
    return {k: transform(v) for k, v in node.items()}


def at(ref, path):
    blob = subprocess.run(
        ["git", "show", f"{ref}:{path}"],
        capture_output=True, text=True, check=True,
    ).stdout
    return yaml.safe_load(blob)


def main(argv):
    if len(argv) != 3:
        print(__doc__)
        return 2
    before_ref, after_ref = argv[1], argv[2]
    rc = 0
    for path in SCENES:
        want = transform(at(before_ref, path))
        got = at(after_ref, path)
        if want == got:
            print(f"IDENTICAL after the stated contract change: {path}")
            continue
        rc = 1
        print(f"MISMATCH: {path}")
        import difflib
        a = json.dumps(want, indent=1, sort_keys=True, ensure_ascii=False).split("\n")
        b = json.dumps(got, indent=1, sort_keys=True, ensure_ascii=False).split("\n")
        print("\n".join(list(difflib.unified_diff(a, b, "expected", "actual", lineterm=""))[:80]))
    return rc


if __name__ == "__main__":
    sys.exit(main(sys.argv))
