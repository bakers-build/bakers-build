#!/usr/bin/env node
/**
 * Generates designbook/design-system/styles/semantic-variables.md from
 * designbook/design-system/design-tokens.yml.
 *
 * WHY GENERATED, NOT HAND-WRITTEN: the token model is the source of truth for every semantic and
 * component ROLE name. A hand-maintained list of those roles drifts the moment a role is renamed,
 * added or removed in design-tokens.yml, and a wrong reference is worse than none — so this
 * script re-derives the table from the YAML every time, and nothing here is ever edited by hand.
 *
 * SCOPE: walks `semantic.*` and `component.*` only. `primitive.*` is deliberately excluded — this
 * overview is about ROLES (what a token is FOR), and primitives carry no role, only a raw value
 * (a colour, a pixel size). Roles are exactly what `semantic.*`/`component.*` add on top.
 *
 * PARSER: design-tokens.yml has no direct `js-yaml`/`yaml` devDependency in this theme's
 * package.json (both exist only transitively, hoisted under pnpm's flat store, and pnpm's
 * strict linking does not expose transitive deps to bare `require`/`import`). Rather than add a
 * new devDependency for one script, this file ships a small zero-dependency parser for the
 * *subset* of YAML this file actually uses: nested block mappings, scalar and quoted-string
 * values, no lists, no anchors, no flow collections. It is not a general YAML parser and is not
 * meant to become one — if design-tokens.yml ever needs a list or a flow collection, reach for a
 * real dependency instead of extending this.
 *
 * AXIS CLASSIFICATION RULE (layout vs style):
 *   1. If a leaf's `$value` is a single `{primitive.LAYOUT_OR_STYLE....}` reference, the axis is
 *      read directly off the second path segment of that reference string (`primitive.layout.*`
 *      -> layout, `primitive.style.*` -> style). No resolution beyond string-splitting is needed
 *      because the primitive tree is itself split into exactly those two top-level groups.
 *   2. If a leaf's `$value` is a mapping of several such references (e.g. `semantic.typography.*`,
 *      whose value is `{fontFamily, fontSize, fontWeight, lineHeight}`), the axis is read off the
 *      FIRST reference found inside it — every observed compound value in this model draws
 *      consistently from one axis (typography and shadow are entirely `primitive.style.*`), so
 *      "first reference" and "majority reference" agree in every case that exists today.
 *   3. If a leaf's `$value` is a literal (no `{...}` reference at all — the only case in this
 *      model is `component.container.max-width: 1280px`), there is no primitive to defer to, so
 *      the leaf is classified by what KIND of property it is: a dimension/width/height/gap/
 *      padding/margin/space name is `layout`; anything else (a colour, a font, a duration) is
 *      `style`. This is the one place the rule falls back to name/type sniffing rather than
 *      following a reference, and it only fires for that one component leaf today.
 *
 * PURPOSE TEXT: mechanically generated from the role's own group + leaf name via a small lookup
 * table with a generic fallback ("<Group> role: <leaf name>"). This is deliberately NOT natural-
 * language generation — no attempt is made to paraphrase context beyond what the name already
 * states, per the ticket's instruction to keep this mechanical and short.
 *
 * OUTPUT: designbook/design-system/styles/semantic-variables.md, next to the hand-written
 * `linear.style.md` — this is the "role reference" counterpart to that file's "how it should
 * look" prose, so the two live side by side.
 *
 * REGENERATE AFTER EVERY design-tokens.yml CHANGE — via `pnpm run generate:variables` (theme
 * package.json) or directly: `node designbook/design-system/generate-semantic-variables.mjs`.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TOKENS_PATH = join(__dirname, 'design-tokens.yml');
const OUTPUT_PATH = join(__dirname, 'styles', 'semantic-variables.md');
const SCRIPT_REL_PATH = 'designbook/design-system/generate-semantic-variables.mjs';

// --- Minimal block-mapping YAML subset parser -----------------------------------------------

function parseYamlSubset(text) {
  const lines = text.split('\n');
  const root = {};
  const stack = [{ indent: -1, node: root }];

  for (const rawLine of lines) {
    const line = rawLine.replace(/\t/g, '  ');
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const indent = line.length - line.trimStart().length;
    const trimmed = line.trim();

    while (stack.length > 1 && indent <= stack[stack.length - 1].indent) {
      stack.pop();
    }
    const parent = stack[stack.length - 1].node;

    const colonIdx = findKeyColon(trimmed);
    const key = unquoteKey(trimmed.slice(0, colonIdx).trim());
    const rest = trimmed.slice(colonIdx + 1).trim();

    if (rest === '') {
      const child = {};
      parent[key] = child;
      stack.push({ indent, node: child });
    } else if (rest === '>-') {
      // Folded scalar block: consume following more-indented lines as one joined string.
      parent[key] = ''; // filled by a follow-up pass if needed; not used for classification.
      stack.push({ indent, node: { __foldedPlaceholder: true } });
    } else {
      parent[key] = parseScalar(rest);
    }
  }
  return root;
}

function findKeyColon(line) {
  let inQuote = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuote) {
      if (ch === inQuote) inQuote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inQuote = ch;
      continue;
    }
    if (ch === ':' && (i === line.length - 1 || line[i + 1] === ' ')) {
      return i;
    }
  }
  return line.indexOf(':');
}

function unquoteKey(key) {
  if ((key.startsWith("'") && key.endsWith("'")) || (key.startsWith('"') && key.endsWith('"'))) {
    return key.slice(1, -1);
  }
  return key;
}

function parseScalar(value) {
  if ((value.startsWith("'") && value.endsWith("'")) || (value.startsWith('"') && value.endsWith('"'))) {
    return value.slice(1, -1);
  }
  return value;
}

// --- Walk semantic.*/component.* ------------------------------------------------------------

function isLeaf(node) {
  return node && typeof node === 'object' && '$value' in node;
}

function collectRoles(node, pathSegments, out) {
  if (!node || typeof node !== 'object') return;
  if (isLeaf(node)) {
    out.push({ path: pathSegments.join('.'), value: node.$value, type: node.$type });
    return;
  }
  for (const [key, child] of Object.entries(node)) {
    if (key.startsWith('$') || key.startsWith('__')) continue;
    collectRoles(child, [...pathSegments, key], out);
  }
}

function referenceAxis(ref) {
  const m = /^\{primitive\.(layout|style)\./.exec(ref);
  return m ? m[1] : null;
}

function classifyAxis(role) {
  const { value, type, path } = role;
  if (typeof value === 'string') {
    const axis = referenceAxis(value);
    if (axis) return axis;
  } else if (value && typeof value === 'object') {
    for (const sub of Object.values(value)) {
      if (typeof sub === 'string') {
        const axis = referenceAxis(sub);
        if (axis) return axis;
      }
    }
  }
  // Literal, no reference — classify by name/type. Only component.container.max-width hits this
  // path today.
  const leafName = path.split('.').pop();
  if (/width|height|gap|padding|margin|space|inset|size/i.test(leafName) && type === 'dimension') {
    return 'layout';
  }
  return 'style';
}

// --- Purpose text -----------------------------------------------------------------------------

const PURPOSE_TABLE = {
  'semantic.color.app': 'Outermost page/app background colour',
  'semantic.color.surface': 'Primary panel/card surface colour',
  'semantic.color.surface-2': 'Secondary (nested) surface colour',
  'semantic.color.surface-3': 'Tertiary (deepest nested) surface colour',
  'semantic.color.input': 'Form input background colour',
  'semantic.color.canvas': 'Drawing/board canvas background colour',
  'semantic.color.text': 'Default body text colour',
  'semantic.color.text-light': 'De-emphasised secondary text colour',
  'semantic.color.text-faint': 'Lowest-emphasis (placeholder-like) text colour',
  'semantic.color.title': 'Heading/title text colour',
  'semantic.color.primary': 'Primary accent/action colour',
  'semantic.color.border': 'Default border colour',
  'semantic.color.border-2': 'Secondary (lighter) border colour',
  'semantic.color.link': 'Hyperlink text colour',
  'semantic.color.focus-ring': 'Keyboard focus outline colour',
  'semantic.color.state-unassigned': 'Unassigned-state indicator colour',
  'semantic.color.state-attention': 'Attention-state indicator colour',
  'semantic.color.state-running': 'Running-state indicator colour',
  'semantic.color.state-lease': 'Leased-state indicator colour',
  'semantic.color.state-offline': 'Offline-state indicator colour',
  'semantic.color.type-feature': 'Feature-type ticket accent colour',
  'semantic.color.type-bug': 'Bug-type ticket accent colour',
  'semantic.color.type-chore': 'Chore-type ticket accent colour',
  'semantic.color.state-unassigned-tint': 'Unassigned-state background tint',
  'semantic.color.state-attention-tint': 'Attention-state background tint',
  'semantic.color.state-running-tint': 'Running-state background tint',
  'semantic.color.state-lease-tint': 'Leased-state background tint',
  'semantic.color.state-offline-tint': 'Offline-state background tint',
  'semantic.color.state-unassigned-ink': 'Unassigned-state text-on-tint colour',
  'semantic.color.state-attention-ink': 'Attention-state text-on-tint colour',
  'semantic.color.state-running-ink': 'Running-state text-on-tint colour',
  'semantic.color.state-lease-ink': 'Leased-state text-on-tint colour',
  'semantic.color.state-ink': 'Mode-invariant text colour for content placed directly on a state-hue background (not its tint), constant in both light and dark mode',
  'semantic.typography.display': 'Largest display heading type style',
  'semantic.typography.heading': 'Primary heading type style',
  'semantic.typography.section': 'Section heading type style',
  'semantic.typography.body': 'Default body-text type style',
  'semantic.typography.lead': 'Lead/intro paragraph type style',
  'semantic.typography.caption': 'Caption/annotation type style',
  'semantic.typography.eyebrow': 'Eyebrow/label type style',
  'semantic.typography.mono': 'Monospaced (code/data) type style',
  'semantic.fontWeight.regular': 'Regular font-weight role',
  'semantic.fontWeight.medium': 'Medium font-weight role',
  'semantic.fontWeight.semibold': 'Semibold font-weight role',
  'semantic.fontWeight.bold': 'Bold font-weight role',
  'semantic.lineHeight.tight': 'Tight line-height role',
  'semantic.lineHeight.snug': 'Snug line-height role',
  'semantic.lineHeight.relaxed': 'Relaxed line-height role',
  'semantic.lineHeight.normal': 'Normal line-height role',
  'semantic.radius.xs': 'Smallest corner-radius role',
  'semantic.radius.sm': 'Small corner-radius role',
  'semantic.radius.md': 'Medium corner-radius role',
  'semantic.shadow.shadow-1': 'Lowest elevation shadow role',
  'semantic.shadow.shadow-2': 'Mid elevation shadow role',
  'semantic.shadow.shadow-3': 'Highest elevation shadow role',
  'semantic.transition.transition-fast': 'Fast-motion transition duration role',
  'semantic.transition.transition-base': 'Base-motion transition duration role',
  'component.section.padding-y': 'Vertical padding owned by a page section',
  'component.grid.gap': 'Gap between items in a grid layout',
  'component.container.max-width': 'Maximum width of a content container',
};

function purposeFor(path) {
  if (PURPOSE_TABLE[path]) return PURPOSE_TABLE[path];
  const segments = path.split('.');
  const group = segments[1] ?? segments[0];
  const leaf = segments[segments.length - 1];
  return `${group.charAt(0).toUpperCase() + group.slice(1)} role: ${leaf}`;
}

// --- Main ---------------------------------------------------------------------------------

const yamlText = readFileSync(TOKENS_PATH, 'utf8');
const model = parseYamlSubset(yamlText);

const roles = [];
collectRoles(model.semantic, ['semantic'], roles);
collectRoles(model.component, ['component'], roles);

for (const role of roles) {
  role.axis = classifyAxis(role);
  role.purpose = purposeFor(role.path);
}

roles.sort((a, b) => a.path.localeCompare(b.path));

const layoutRoles = roles.filter((r) => r.axis === 'layout');
const styleRoles = roles.filter((r) => r.axis === 'style');

function table(rows) {
  const header = '| Name | Axis | Purpose |\n| --- | --- | --- |\n';
  return header + rows.map((r) => `| \`${r.path}\` | ${r.axis} | ${r.purpose} |`).join('\n') + '\n';
}

const out = `<!--
GENERATED FILE — do not hand-edit.

Regenerated by: ${SCRIPT_REL_PATH}
Run from the theme root: \`pnpm run generate:variables\`, or
\`node ${SCRIPT_REL_PATH}\`
Regenerate after ANY change to design-tokens.yml — a stale copy is
worse than none, which is why this file is generated rather than
maintained by hand.
-->

# Semantic and component variable overview

This is the canonical reference for every \`semantic.*\` and
\`component.*\` role declared in
[\`design-tokens.yml\`](../design-tokens.yml). \`primitive.*\` values
are intentionally excluded — this table is about ROLES (what a token
is for), and only the semantic and component layers carry a role
name; primitives are raw values with no role attached.

Each role is classified onto one of the two axes the token model is
split into: **layout** (geometry — spacing, sizing) or **style**
(colour, type, elevation, motion). See the generator script's header
comment for the exact classification rule.

## Layout axis (${layoutRoles.length})

${table(layoutRoles)}
## Style axis (${styleRoles.length})

${table(styleRoles)}`;

writeFileSync(OUTPUT_PATH, out, 'utf8');
console.log(`Wrote ${roles.length} role(s) (${layoutRoles.length} layout, ${styleRoles.length} style) to ${OUTPUT_PATH}`);
