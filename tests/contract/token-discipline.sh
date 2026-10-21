#!/usr/bin/env bash
set -euo pipefail

# A missing `yaml` module reads as eight ordinary check failures below — the one failure shape
# this suite exists to make impossible. Fail loud, once, before any check runs.
if ! python3 -c 'import yaml' >/dev/null 2>&1; then
  printf 'FATAL: python3 module "yaml" is not installed (pip: PyYAML, apt: python3-yaml) — required by this suite\n' >&2
  exit 1
fi

# BB-504 (Plan Task 7) — token discipline, test-first.
#
# BB-504 splits the token model into two axes — `primitive.layout.*` (geometry: spacing,
# row/control heights, radius) and `primitive.style.*` (character: colour, type, elevation,
# duration, focus ring) — with a `semantic.*` / `component.*` layer above both, and two THEMES
# (`themes.cozy` — a primitive-only override selected by `[data-layout="cozy"]`; `themes.dark` —
# a semantic override plus one primitive (elevation) override, selected by `[data-mode="dark"]`).
# This suite asserts the DISCIPLINE that model requires of every component, ahead of the
# entstylen work (Tasks 9/10) that will make it true. Written test-first: most of its eight checks
# are expected RED today (1, 4, 5, 7, 8) and are supposed to turn GREEN only once the scoped
# components stop reaching past the semantic layer.
#
# Scope — two component groups, each with a different discipline:
#   LAYOUT components own the geometry between things (gap, outer margin, fixed widths) because
#   they are literally what places one thing beside another.
#   CONTENT components render one thing and must not reach outside themselves for placement.
#
# Eight checks:
#   1. Zero arbitrary Tailwind values (`prefix-[...]`) in the scoped components.
#   2. No component anywhere reaches past the semantic/component layer to a bare
#      `primitive.layout.*` / `primitive.style.*` leaf name.
#   3. Every semantic-ish utility fragment actually used in the scoped components resolves to a
#      `semantic.*` / `component.*` key the token model declares.
#   4. No BEM-style class (`block__element`, or a class that is just the bare component name) in
#      the scoped components.
#   5. No `*.src.css` file outside three named exceptions:
#        (a) `css/tokens/*.src.css` — generated token CSS (Designbook's own output, not hand-written).
#        (b) Global framework-mechanical CSS inside `css/app.src.css` that patches a cross-cutting
#            behaviour no single component's Twig can express: the off-canvas layer fix — the
#            unlayered `#drupal-off-canvas [data-component-id^="bb_theme:"] { all: revert-layer; }`
#            rule that corrects a cascade problem Tailwind's `@layer` cannot reach from inside a
#            component template — and the `[x-cloak] { display: none !important; }` rule BB-505
#            added, which hides the pre-boot frame for any element Alpine has not yet bound and by
#            construction targets no component's own class list (no template in this theme uses the attribute today). Both are real and present.
#        (c) Base styles reserved for `bb_rich`-generated HTML. NOT YET PRESENT in this tree —
#            reserved here so this check does not need editing the day it is added, and its
#            absence is why this exception is vacuous today rather than satisfied.
#      TWO rules used to sit in this list and are GONE from it:
#        - The link-colour pair (`a { color; text-decoration }`, `a:hover { text-decoration }`)
#          moved into the `rich-text` component's own class list
#          (`[&_a]:text-link [&_a]:no-underline [&_a:hover]:underline`), the one place a bare
#          `<a>` inside rendered content needs styling, using the same `text-link` semantic token
#          via a Tailwind arbitrary-descendant utility rather than raw CSS.
#        - `.js-pager__items a { display: inline-flex }` is GONE outright, not moved: the pager is
#          now themed entirely from `templates/pager.html.twig`'s own token-utility classes (every
#          link already carries its own `inline-flex`), so the global rule was redundant and is
#          deleted rather than re-homed. Neither is a named exception any more.
#      Every OTHER `*.src.css` file (`css/_demo.src.css`) and any other rule under `css/app.src.css`
#      is an undeclared fourth exception and fails this check.
#   6. The two primitive axes are disjoint — no leaf name is declared under both
#      `primitive.layout.*` and `primitive.style.*`.
#   7. No outer margin utility (`m-`/`mt-`/`mb-`/`ml-`/`mr-`/`mx-`/`my-`) in a CONTENT component —
#      only a layout component owns the space between things.
#   8. No arbitrary or fixed pixel-style `max-w-*` outside a layout component — a content
#      component may cap its own reading width (`max-w-full`, `max-w-none`, an `NNch` reading
#      width) but a fixed pixel ceiling belongs to whatever places the content, i.e. a layout
#      component.
#
# Out of scope, deliberately:
#   - Any component outside the SCOPED list for checks 1, 3, 7 and 8 — those checks are about the
#     discipline this ticket's plan names for THESE fourteen components. Checks 2, 5 and 6 are
#     asserted tree-wide (2 and 5 name why in their own sections above).
#   - Whether a semantic/component key ITSELF resolves to the right primitive — that is the token
#     model's own internal consistency, asserted by Task 3's work, not a component's discipline.
#
# How to run — no DDEV environment, no Drupal bootstrap and no theme build required; every check is
# a read of repository content:
#   bash tests/contract/token-discipline.sh
#
# Exit code is the verdict: 0 = every check passed, 1 = at least one failed.

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
THEME="$ROOT/web/themes/custom/bb_theme"
COMPONENTS="$THEME/components"
TOKENS="$THEME/designbook/design-system/design-tokens.yml"
failures=0

check() {
  local label="$1"
  shift
  if "$@"; then printf 'PASS %s\n' "$label"; else printf 'FAIL %s\n' "$label"; failures=$((failures + 1)); fi
}

# --- Scope ---------------------------------------------------------------------------------------
#
# The plan's suggested names, checked against what actually exists under components/ before use —
# every one of the fourteen matched a real directory 1:1 (including the hyphenated
# `active-filters`), so nothing was renamed or dropped.
LAYOUT_COMPONENTS="shell sidebar zone canvas board list table"
CONTENT_COMPONENTS="nav account_switcher person status_bar badge filters active-filters page_header"
SCOPED="$LAYOUT_COMPONENTS $CONTENT_COMPONENTS"

scoped_twig_files() {
  local group="$1" c
  for c in $group; do
    for f in "$COMPONENTS/$c"/*.twig; do
      [ -f "$f" ] && printf '%s\n' "$f"
    done
  done
}

all_twig_files() {
  local f
  for f in "$COMPONENTS"/*/*.twig; do
    [ -f "$f" ] && printf '%s\n' "$f"
  done
}

# --- 0. Non-vacuity -------------------------------------------------------------------------------

enumerations_are_non_vacuous() {
  local rc=0 count c
  for c in $SCOPED; do
    if [ ! -d "$COMPONENTS/$c" ]; then
      printf '  components/%s/ does not exist — the scope named in the plan is stale\n' "$c"
      rc=1
    fi
  done
  count="$(scoped_twig_files "$SCOPED" | grep -c . || true)"
  if [ "$count" -lt 10 ]; then
    printf '  the scoped-component enumeration returned only %s *.twig file(s)\n' "$count"
    rc=1
  fi
  count="$(all_twig_files | grep -c . || true)"
  if [ "$count" -lt 30 ]; then
    printf '  the tree-wide component enumeration returned only %s *.twig file(s)\n' "$count"
    rc=1
  fi
  [ -f "$TOKENS" ] || { printf '  %s does not exist\n' "${TOKENS#"$ROOT"/}"; rc=1; }
  return "$rc"
}

check "0 the scoped and tree-wide component enumerations are non-vacuous" enumerations_are_non_vacuous

# --- 1. Zero arbitrary values in the scoped components -------------------------------------------

check1_no_arbitrary_values() {
  local hits
  # Strip Twig comments ({# ... #}) first: prose inside them may name an
  # arbitrary-value class as documentation, and that is not a violation.
  # Two patterns: bracket arbitrary values (`prefix-[...]`), AND fractional/dotted
  # numeric suffixes on a spacing/sizing utility (`gap-1.25`, `h-6.5`) — a half-step
  # relocated OUT of brackets and into a dotted utility name is still a half-step,
  # not an integer `--spacing` multiplier, and this class of regression (BB-504
  # review) is otherwise invisible to the bracket-only pattern. A bracket followed by `:` is
  # an arbitrary VARIANT (`group-[.is-collapsed]:hidden`), a selector rather than a value, and
  # the styling rule forbids values only.
  hits="$(scoped_twig_files "$SCOPED" | while IFS= read -r f; do
    perl -0777 -pe 's/\{#.*?#\}//gs' "$f" \
      | grep -noE '\b[a-z-]+-\[[^]]+\]:?|\b(p|px|py|pt|pr|pb|pl|m|mx|my|mt|mr|mb|ml|gap|gap-x|gap-y|space-x|space-y|w|h|min-w|min-h|max-w|max-h|inset|top|right|bottom|left|basis)-[0-9]+\.[0-9]+\b' \
      | grep -v '\]:$' \
      | sed "s|^|${f#"$COMPONENTS"/}:|"
  done)"
  if [ -n "$hits" ]; then
    printf '  %s arbitrary-value hit(s) in the scoped components:\n' "$(printf '%s\n' "$hits" | grep -c .)"
    printf '%s\n' "$hits" | sed 's/^/    /' | head -20
    [ "$(printf '%s\n' "$hits" | grep -c .)" -gt 20 ] && printf '    … (truncated)\n'
    return 1
  fi
}

check "1 zero arbitrary Tailwind values (prefix-[...]) in the scoped components" check1_no_arbitrary_values

# --- 2. No primitive reference, in ANY component --------------------------------------------------
#
# Only the primitive leaf names that plausibly collide with a real Tailwind utility fragment are
# grepped, each scoped to the utility categories that name could plausibly appear in — `sm`/`md`/
# `xs` alone would match half the theme's breakpoint prefixes and Tailwind's own default scale, so
# a bare-name scan would be noise rather than a check.
#
# ONE NAMED COLLISION, spelled out rather than silently resolved: `primitive.style.fontSize.*`
# (`display`, `heading`, `body`, `caption`, `eyebrow`, `mono`) share their leaf names with
# `semantic.typography.*`, and `css/tokens/typography.src.css` re-declares the SAME CSS custom
# property (`--text-heading` etc.) to compose the primitive size with a weight and line-height —
# there is no separate CSS class to tell "primitive" and "semantic" usage apart once compiled, and
# the design-tokens.yml model does not distinguish them at that leaf either. `text-display` /
# `text-heading` / `text-body` / `text-caption` / `text-eyebrow` / `text-mono` are therefore treated
# as the SEMANTIC typography reference (checked positively in check 3), not as a primitive
# violation here.
#
# RADIUS `xs`/`sm`/`md` ARE THE SEMANTIC NAMES, not primitive ones, since the primitive leaf
# renamed to raw pixel numbers (`primitive.layout.radius.5/7/10`, `css/tokens/primitive-radius.src.css`
# declares `--radius-5/7/10`) and `semantic.radius.xs/sm/md` (`css/tokens/semantic-radius.src.css`)
# maps `--radius-xs` etc. to those. `rounded-xs`/`rounded-sm`/`rounded-md` therefore ARE a
# component reaching the semantic layer, exactly as this check wants — checking for THOSE names
# here would flag correct usage. What would actually be a violation is a component naming the
# primitive directly, which Tailwind spells `rounded-5`/`rounded-7`/`rounded-10`.
#
# `fontWeight`/`lineHeight`/`fontFamily` HAVE NO SEPARATE SEMANTIC CLASS NAME to reach for, unlike
# colour/spacing/radius: `css/tokens/primitive-weight.src.css`, `primitive-leading.src.css` and
# `primitive-font.src.css` declare `--font-weight-bold`, `--leading-tight`, `--font-mono` etc.
# directly as Tailwind v4 `@theme` keys, which means Tailwind's OWN utilities `font-bold`,
# `leading-tight`, `font-mono` compile against those variables — there is no distinguishable
# "semantic" spelling of a font weight, line height or font family the way `bg-app` is to
# `bg-neutral-500` or `rounded-xs` is to `rounded-7`. There is no `semantic.fontWeight.*` /
# `semantic.lineHeight.*` in design-tokens.yml either: weight/line-height only exist bundled
# inside `semantic.typography.*` composites (`display`, `heading`, `body`, …), which check 3
# already asserts positively via the `text-*` classes. A bare `font-bold`/`leading-tight`/
# `font-mono` IS this theme's semantic-layer expression for those three axes, so they are excluded
# from this check rather than chased as an unfixable "violation" at the component level.
check2_no_primitive_reference() {
  local rc=0 hits
  local colors="neutral-50 neutral-100 neutral-200 neutral-300 neutral-400 neutral-500 neutral-600 neutral-700 neutral-800 neutral-900 accent-50 accent-100 accent-200 accent-300 accent-400 accent-500 accent-600 accent-700 accent-800 accent-900 red-50 red-100 red-200 red-300 red-400 red-500 red-600 red-700 red-800 red-900 amber-50 amber-100 amber-200 amber-300 amber-400 amber-500 amber-600 amber-700 amber-800 amber-900 teal-50 teal-100 teal-200 teal-300 teal-400 teal-500 teal-600 teal-700 teal-800 teal-900 indigo-50 indigo-100 indigo-200 indigo-300 indigo-400 indigo-500 indigo-600 indigo-700 indigo-800 indigo-900"
  local color_alt space_alt
  color_alt="$(printf '%s\n' $colors | paste -sd'|')"
  space_alt="space-1|space-2|space-3|space-4|space-5|space-6"

  # Colour families used as a bg/text/border/ring/shadow/decoration/divide/outline/fill/stroke/
  # from/via/to utility fragment.
  hits="$(all_twig_files | while IFS= read -r f; do
    grep -noE "\b(bg|text|border|ring|shadow|decoration|divide|outline|fill|stroke|from|via|to)-($color_alt)\b" "$f" | sed "s|^|${f#"$COMPONENTS"/}:|"
  done)"
  [ -n "$hits" ] && { printf '  primitive colour used directly as a utility fragment:\n'; printf '%s\n' "$hits" | sed 's/^/    /'; rc=1; }

  # Spacing primitives used as p/m/gap/w/h/inset/top/right/bottom/left utilities.
  hits="$(all_twig_files | while IFS= read -r f; do
    grep -noE "\b(p|px|py|pt|pr|pb|pl|m|mx|my|mt|mr|mb|ml|gap|gap-x|gap-y|space-x|space-y|w|h|min-w|min-h|max-w|max-h|inset|top|right|bottom|left)-($space_alt)\b" "$f" | sed "s|^|${f#"$COMPONENTS"/}:|"
  done)"
  [ -n "$hits" ] && { printf '  primitive spacing used directly as a utility fragment:\n'; printf '%s\n' "$hits" | sed 's/^/    /'; rc=1; }

  # row-h / control-h used directly.
  hits="$(all_twig_files | while IFS= read -r f; do
    grep -noE '\b(h|min-h|max-h)-(row-h|control-h)\b' "$f" | sed "s|^|${f#"$COMPONENTS"/}:|"
  done)"
  [ -n "$hits" ] && { printf '  primitive row-h/control-h used directly as a utility fragment:\n'; printf '%s\n' "$hits" | sed 's/^/    /'; rc=1; }

  # radius 5/7/10 used directly (rounded / rounded-t / rounded-tl / …) — the raw primitive leaf
  # names. `xs`/`sm`/`md` are the SEMANTIC names (see the comment above) and are not checked here.
  hits="$(all_twig_files | while IFS= read -r f; do
    grep -noE '\brounded(-[tblr]{1,2})?-(5|7|10)\b' "$f" | sed "s|^|${f#"$COMPONENTS"/}:|"
  done)"
  [ -n "$hits" ] && { printf '  primitive radius used directly as a utility fragment:\n'; printf '%s\n' "$hits" | sed 's/^/    /'; rc=1; }

  # fontWeight/lineHeight/fontFamily are deliberately NOT checked here — see the comment above:
  # Tailwind's own `font-bold`/`leading-tight`/`font-mono` utilities compile against this theme's
  # `--font-weight-*`/`--leading-*`/`--font-*` variables, and there is no distinguishable semantic
  # spelling of any of the three to check for instead.

  return "$rc"
}

check "2 no component reaches past semantic to a bare primitive.layout/style leaf name" check2_no_primitive_reference

# --- 3. Every used semantic/component token exists in the model -----------------------------------
#
# Only categories that plausibly carry a token VALUE are scanned (colour/typography families):
# `border`/`ring` are narrowed to exclude Tailwind's own directional/style/width vocabulary
# (`border-b`, `border-collapse`, `border-2`, …), which is not a token reference at all and would
# otherwise be reported as an "unknown token" for a class this ticket has no opinion about.
# `font-sans`/`font-mono` (fontFamily) are check 2's job, not this one's.

check3_used_tokens_exist_in_model() {
  python3 - "$TOKENS" "$COMPONENTS" "$SCOPED" <<'PY'
import sys
import re
import yaml

tokens_path, comps, scoped = sys.argv[1], sys.argv[2], sys.argv[3].split()
model = yaml.safe_load(open(tokens_path)) or {}

allowed = set()


def collect_leaves(node, out):
    if isinstance(node, dict):
        if '$value' in node:
            return
        for key, value in node.items():
            out.add(key)
            collect_leaves(value, out)


collect_leaves(model.get('semantic') or {}, allowed)
collect_leaves(model.get('component') or {}, allowed)
# The typography/fontSize collision (see check 2's comment): the six fontSize leaf names are the
# semantic typography reference too.
allowed |= {'display', 'heading', 'body', 'caption', 'eyebrow', 'mono', 'section', 'lead'}

# Tailwind's own vocabulary in these categories — not tokens, and not violations.
builtin = {
    'transparent', 'current', 'inherit', 'none', 'auto', 'full', 'black', 'white',
    'left', 'center', 'right', 'justify', 'ellipsis', 'clip', 'lg', 'sm', 'md', 'xl',
    '2xl', '3xl', 'xs', 'top', 'bottom', 'start', 'end',
}
# `font-`'s own non-token vocabulary (fontFamily is check 2's job; weight/style are Tailwind's).
font_builtin = {'sans', 'mono', 'serif', 'thin', 'light', 'normal', 'black', 'italic'}
# `border`/`ring`'s directional, style and width vocabulary — never a colour-token reference.
# Covers `border-b`, `border-b-0`, `border-t-2`, `border-collapse`, …
border_builtin_re = re.compile(
    r'^([trblxyse]{1,2}(-\d+)?|\d+|collapse|separate|spacing|solid|dashed|dotted|double|hidden)$'
)

categories = ('bg', 'text', 'border', 'ring', 'shadow', 'duration', 'font', 'leading')
pattern = re.compile(r'\b(' + '|'.join(categories) + r')-([a-zA-Z0-9_-]+)\b')

rc = 0
for name in scoped:
    for path in sorted(__import__('glob').glob(f'{comps}/{name}/*.twig')):
        rel = path[len(comps) + 1:]
        text = open(path).read()
        for m in pattern.finditer(text):
            category, suffix = m.group(1), m.group(2)
            if suffix.startswith('[') or '[' in suffix:
                continue
            if suffix in builtin or re.fullmatch(r'\d+', suffix):
                continue
            if category == 'font' and suffix in font_builtin:
                continue
            if category in ('border', 'ring') and border_builtin_re.match(suffix):
                continue
            if suffix in allowed:
                continue
            print(f'  {rel}: `{category}-{suffix}` does not resolve to a semantic.*/component.* key')
            rc = 1

sys.exit(rc)
PY
}

check "3 every semantic-ish utility fragment used in the scoped components resolves to a token" \
  check3_used_tokens_exist_in_model

# --- 4. No BEM class in the scoped components ------------------------------------------------------

check4_no_bem_class() {
  python3 - "$COMPONENTS" "$SCOPED" <<'PY'
import glob
import re
import sys

comps, scoped = sys.argv[1], sys.argv[2].split()
class_attr = re.compile(r'class\s*=\s*"([^"]*)"')
rc = 0

for name in scoped:
    for path in sorted(glob.glob(f'{comps}/{name}/*.twig')):
        rel = path[len(comps) + 1:]
        for lineno, line in enumerate(open(path), start=1):
            for m in class_attr.finditer(line):
                for cls in m.group(1).split():
                    # Twig expression fragments (e.g. `{{ x ? 'a' : 'b' }}`) are not a class name.
                    if '{{' in cls or '}}' in cls:
                        continue
                    if re.search(r'[a-z0-9]+__[a-z0-9-]+', cls):
                        print(f'  {rel}:{lineno}: BEM-style class `{cls}`')
                        rc = 1
                    elif cls == name or cls == name.replace('_', '-') or cls == name.replace('-', '_'):
                        print(f'  {rel}:{lineno}: class `{cls}` is just the bare component name')
                        rc = 1

sys.exit(rc)
PY
}

check "4 no BEM class (block__element or the bare component name) in the scoped components" \
  check4_no_bem_class

# --- 5. No CSS file outside the three named exceptions ---------------------------------------------

check5_no_unexpected_css_file() {
  python3 - "$THEME" <<'PY'
import glob
import os
import re
import sys

theme = sys.argv[1]
rc = 0

files = sorted(glob.glob(f'{theme}/css/**/*.src.css', recursive=True))
for path in files:
    rel = os.path.relpath(path, theme)
    if rel.startswith('css/tokens/'):
        continue  # exception (a): generated token CSS.
    if rel != 'css/app.src.css':
        print(f'  {rel}: a *.src.css file outside the three named exceptions')
        rc = 1
        continue

    src = open(path).read()
    # Strip /* */ comments (this file has no // comments).
    stripped = re.sub(r'/\*.*?\*/', '', src, flags=re.S)
    # Drop @import and @source lines — the file's own composition and Tailwind's scan
    # configuration, neither of which is an authored CSS rule.
    stripped = re.sub(r'^\s*@(import|source)[^\n]*\n?', '', stripped, flags=re.M)
    # Drop exception (b): the off-canvas rule, `<selector list> { … }`, and the `[x-cloak]` rule.
    stripped = re.sub(
        r'#drupal-off-canvas[^{]*\{[^}]*\}',
        '',
        stripped,
        flags=re.S,
    )
    stripped = re.sub(
        r'\[x-cloak\]\s*\{[^{}]*\}',
        '',
        stripped,
        count=1,
    )
    # The document-root sidebar-collapse rules and the autosave toast's `[hidden]` companion are
    # named by styling exception 2 as well.
    stripped = re.sub(r'html\[data-sidebar-collapsed\][^{]*\{[^}]*\}', '', stripped, flags=re.S)
    stripped = re.sub(r'\[data-form-autosave-status\]\[hidden\]\s*\{[^{}]*\}', '', stripped, count=1)
    # Exception (c), reserved `bb_rich` base styles, has no rule to drop: nothing in this file
    # targets markdown-rendered `bb_rich` output today, so it stays vacuous rather than matched.
    # The former `a`/`a:hover` link-colour pair and `.js-pager__items a` rule are NOT dropped here
    # any more — neither exists in this file: the former moved into the `rich-text` component's
    # own class list, the latter was deleted outright once `templates/pager.html.twig` themed
    # every link itself.
    # What is left should be only `@layer ... { }` wrapper punctuation and whitespace once every
    # rule inside is accounted for — so any remaining SELECTOR (a `{` not immediately preceded by
    # only "@layer NAME") is a rule this check has not been told is one of the three exceptions.
    remaining_rules = re.findall(r'([^\n{};]+)\{([^{}]*)\}', stripped)
    for selector, body in remaining_rules:
        selector = selector.strip()
        body = body.strip()
        if not body:
            continue
        if re.match(r'^@layer\s+[\w-]+$', selector):
            continue
        print(f'  css/app.src.css: rule `{selector}{{ {body[:60]} }}` is outside the named off-canvas exception')
        rc = 1

sys.exit(rc)
PY
}

check "5 no *.src.css file outside the tokens/off-canvas/bb_rich exceptions" check5_no_unexpected_css_file

# --- 6. The two primitive axes are disjoint ---------------------------------------------------------

check6_axes_are_disjoint() {
  python3 - "$TOKENS" <<'PY'
import sys
import yaml

model = yaml.safe_load(open(sys.argv[1])) or {}
primitive = model.get('primitive') or {}


def leaves(node, out):
    if isinstance(node, dict):
        if '$value' in node:
            return
        for key, value in node.items():
            if isinstance(value, dict) and '$value' in value:
                out.add(key)
            else:
                leaves(value, out)


layout_leaves, style_leaves = set(), set()
leaves(primitive.get('layout') or {}, layout_leaves)
leaves(primitive.get('style') or {}, style_leaves)

overlap = layout_leaves & style_leaves
if overlap:
    print(f'  the same leaf name is declared under both primitive.layout.* and primitive.style.*: {sorted(overlap)}')
    sys.exit(1)
if len(layout_leaves) < 5 or len(style_leaves) < 5:
    print(f'  the axis extraction is too small to be trusted (layout={len(layout_leaves)}, style={len(style_leaves)})')
    sys.exit(1)
PY
}

check "6 no leaf name is declared under both primitive.layout.* and primitive.style.*" \
  check6_axes_are_disjoint

# --- 7. No outer margin in a content component -------------------------------------------------------

check7_no_margin_in_content() {
  local hits
  hits="$(scoped_twig_files "$CONTENT_COMPONENTS" | while IFS= read -r f; do
    grep -noE '\b(m|mt|mb|ml|mr|mx|my)-[^ "]+' "$f" | sed "s|^|${f#"$COMPONENTS"/}:|"
  done)"
  if [ -n "$hits" ]; then
    printf '  a content component declares an outer margin (only a layout component owns the space between things):\n'
    printf '%s\n' "$hits" | sed 's/^/    /'
    return 1
  fi
}

check "7 no outer margin utility in a content component" check7_no_margin_in_content

# --- 8. No arbitrary width limit outside a layout component -------------------------------------------

check8_no_arbitrary_max_width_outside_layout() {
  python3 - "$COMPONENTS" "$LAYOUT_COMPONENTS" "$SCOPED" <<'PY'
import glob
import os
import re
import sys

comps, layout, scoped = sys.argv[1], set(sys.argv[2].split()), set(sys.argv[3].split())
# A dialog capped to the viewport (`max-w-[90vw]`) is legitimately a content-width limit per
# spec rule 4 — a viewport-relative cap, not a fixed pixel/spacing value — so vw/vh join ch.
allowed = re.compile(r'^max-w-(full|none|\[?\d+(ch|vw|vh)\]?|prose)$')
pattern = re.compile(r'\bmax-w-(\[[^\]]+\]|[a-zA-Z0-9]+)(?=[^a-zA-Z0-9]|$)')
rc = 0


def strip_twig_comments(lines):
    """A `{# ... #}` comment is not markup — blank it out, line by line, keeping line numbers true."""
    out, inblk = [], False
    for line in lines:
        if inblk:
            end = line.find('#}')
            if end == -1:
                out.append('')
                continue
            line = ' ' * (end + 2) + line[end + 2:]
            inblk = False
        while True:
            start = line.find('{#')
            if start == -1:
                break
            end = line.find('#}', start)
            if end == -1:
                line = line[:start]
                inblk = True
                break
            line = line[:start] + ' ' * (end + 2 - start) + line[end + 2:]
        out.append(line)
    return out


for path in sorted(glob.glob(f'{comps}/*/*.twig')):
    name = os.path.basename(os.path.dirname(path))
    rel = path[len(comps) + 1:]
    # Scoped to the fourteen ticket-scoped components (checks 1/3/7/8), not the whole tree —
    # a fixed max-w in an out-of-scope component is that component's own, pre-existing decision.
    if name not in scoped:
        continue
    if name in layout:
        continue
    for lineno, line in enumerate(strip_twig_comments(open(path).readlines()), start=1):
        for m in pattern.finditer(line):
            token = f'max-w-{m.group(1)}'
            if allowed.match(token):
                continue
            print(f'  {rel}:{lineno}: `{token}` outside any layout component')
            rc = 1

sys.exit(rc)
PY
}

check "8 no arbitrary/fixed max-w outside a layout component" \
  check8_no_arbitrary_max_width_outside_layout

# --- Verdict -------------------------------------------------------------------------------------

if [ "$failures" -eq 0 ]; then
  printf '\nAll checks passed.\n'
  exit 0
else
  printf '\n%s check(s) failed.\n' "$failures"
  exit 1
fi
