import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// BB-236 AC-10 / spec Decision 7 — the guard the ticket assumed already existed.
// It did not: `bakers-cli/ui/tests/no-bakers-ui-import.test.ts` guards a DIFFERENT
// boundary (the `ui` command package must not statically import this renderer), and
// `assert-acyclic.mjs` only inspects `@bakers-build/*` edges, so neither would catch a
// `dropsh` dependency here. Modelled on that file, three assertions:
//
//   1. the manifest declares no dropsh dependency of any kind;
//   2. no file under `src/` imports from dropsh;
//   3. no file under `src/Form/` imports anything outside `Form/` — the mechanical
//      form of AC-1's "no I/O, and no knowledge of tickets, conductors, JSON:API or
//      agents";
//   4. and the CONVERSE: a data module never depends on the SHARED form kernel
//      (`src/Form/`) or on another slice's `Form/`. A data service returns data for
//      whatever purpose; only the two adapters (`create-form-data.ts`,
//      `edit-form-data.ts`) build form vocabulary out of it. Left to convention this
//      eroded twice — the arrow pointed at `Form/` from every loader — so it is
//      asserted mechanically here.
//
//      What that rule does NOT forbid, and never did: naming the OWN slice's form
//      PAYLOAD type — a type-only import of a sibling in its own slice, which G2
//      permits structurally. G7 below is what keeps that a decision rather than a
//      hole: the importer is named, and the import must be type-only, so the module
//      can describe a payload without being able to run any of the kernel.

const packageDir = join(dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = join(packageDir, 'src');

function tsFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...tsFiles(p));
    else if (name.endsWith('.ts')) out.push(p);
  }
  return out;
}

function sourceFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...sourceFiles(p));
    else if (name.endsWith('.ts') || name.endsWith('.tsx')) out.push(p);
  }
  return out;
}

/** Every file below `dir`, whatever its extension. */
function allFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? allFiles(p) : [p];
  });
}

function subDirs(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((n) => statSync(join(dir, n)).isDirectory());
}

/** Every module specifier this file imports from or re-exports from. */
function specifiers(file: string): string[] {
  const source = readFileSync(file, 'utf8');
  const out: string[] = [];
  for (const m of source.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)) {
    if (m[1] !== undefined) out.push(m[1]);
  }
  // A bare side-effect import (`import 'x'`) names no binding but is still an edge.
  for (const m of source.matchAll(/^\s*import\s+['"]([^'"]+)['"]/gm)) {
    if (m[1] !== undefined) out.push(m[1]);
  }
  return out;
}

/**
 * Every `import … from '…'` in a file, with whether it is TYPE-ONLY.
 *
 * `specifiers()` answers "is there an edge"; this answers "is there an edge at
 * RUNTIME", which is the whole difference between a data module that can call
 * the form kernel and one that can only describe a shape it is handed. Both the
 * statement form (`import type { X } from`) and the inline one
 * (`import { type X } from`) count as type-only.
 */
function imports(file: string): { spec: string; typeOnly: boolean }[] {
  const source = readFileSync(file, 'utf8');
  const out: { spec: string; typeOnly: boolean }[] = [];
  for (const m of source.matchAll(
    /\bimport\s+(type\s+)?([^'"]*?)\bfrom\s+['"]([^'"]+)['"]/g,
  )) {
    const clause = (m[2] ?? '').trim();
    const named = clause
      .replace(/[{}]/g, '')
      .split(',')
      .filter((part) => part.trim() !== '');
    const inlineTypeOnly =
      clause.startsWith('{') &&
      named.length > 0 &&
      named.every((part) => /^\s*type\s+/.test(part));
    out.push({
      spec: m[3] as string,
      typeOnly: m[1] !== undefined || inlineTypeOnly,
    });
  }
  return out;
}

const isDropsh = (spec: string): boolean =>
  spec === 'dropsh' ||
  spec.startsWith('dropsh/') ||
  spec.startsWith('@dropsh/');

describe('@bakers-build/addon-bakers-ui stays dropsh-decoupled (BB-236 AC-10)', () => {
  const manifest = JSON.parse(
    readFileSync(join(packageDir, 'package.json'), 'utf8'),
  ) as Record<string, Record<string, string> | undefined>;

  it('declares no dropsh dependency in any dependency block', () => {
    // The renderer consumes a hand-written NARROWING of the client (`types.ts`), so a
    // dropsh dep would be a real coupling, not a formality.
    const offenders: string[] = [];
    for (const block of [
      'dependencies',
      'devDependencies',
      'peerDependencies',
    ]) {
      for (const name of Object.keys(manifest[block] ?? {})) {
        if (isDropsh(name)) offenders.push(`${block}: ${name}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('has no dropsh import anywhere under src/', () => {
    const offenders = tsFiles(srcDir).filter((f) =>
      specifiers(f).some(isDropsh),
    );
    expect(offenders.map((f) => relative(packageDir, f))).toEqual([]);
  });
});

const isReact = (spec: string): boolean =>
  spec === 'react' ||
  spec.startsWith('react/') ||
  spec === 'react-dom' ||
  spec.startsWith('react-dom/') ||
  spec === 'react-reconciler' ||
  spec.startsWith('react-reconciler/') ||
  spec === '@opentui/react' ||
  spec.startsWith('@opentui/react/');

// The TUI paints through OpenTUI's own renderables only. React was removed
// because it was the slow path; these keep it from coming back through a
// manifest, a compiler setting, a pragma or a single import. Route and export
// names that merely CONTAIN the word (`ticket.react`, `./react-experiment`)
// are compatibility names, not a runtime, and are deliberately not matched.
describe('@bakers-build/addon-bakers-ui is React-free', () => {
  const manifest = JSON.parse(
    readFileSync(join(packageDir, 'package.json'), 'utf8'),
  ) as Record<string, Record<string, string> | undefined>;
  const scanned = ['src', 'tests', 'tests-bun'].flatMap((dir) =>
    sourceFiles(join(packageDir, dir)),
  );

  it('has files to scan (the guard cannot pass by finding nothing)', () => {
    expect(scanned.length).toBeGreaterThan(100);
  });

  it('declares no React package in any dependency block', () => {
    const offenders: string[] = [];
    for (const block of [
      'dependencies',
      'devDependencies',
      'peerDependencies',
      'optionalDependencies',
    ]) {
      for (const name of Object.keys(manifest[block] ?? {})) {
        if (isReact(name) || name === '@types/react')
          offenders.push(`${block}: ${name}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('configures no JSX runtime', () => {
    const tsconfig = readFileSync(join(packageDir, 'tsconfig.json'), 'utf8');
    expect(tsconfig).not.toMatch(/"jsx/);
    expect(tsconfig).not.toContain('.tsx');
  });

  it('has no .tsx module and no React import, pragma or JSX runtime', () => {
    const offenders: string[] = [];
    for (const file of scanned) {
      const name = relative(packageDir, file);
      if (file.endsWith('.tsx')) offenders.push(`${name}: .tsx module`);
      for (const spec of specifiers(file))
        if (isReact(spec)) offenders.push(`${name} → ${spec}`);
      // This file names the patterns it bans.
      if (
        file !== fileURLToPath(import.meta.url) &&
        /@jsxImportSource|jsx-runtime/.test(readFileSync(file, 'utf8'))
      )
        offenders.push(`${name}: JSX runtime`);
    }
    expect(offenders).toEqual([]);
  });
});

// The shared widgets are this package's own modules. Neither a third-party
// tree nor a name for it may come back by a path, an import, a comment or a
// document.
describe('@bakers-build/addon-bakers-ui carries no vendored widget library', () => {
  it('names termcn nowhere in its sources, tests or docs', () => {
    const offenders = ['src', 'tests', 'tests-bun', 'docs']
      .flatMap((dir) => allFiles(join(packageDir, dir)))
      .filter((file) => file !== fileURLToPath(import.meta.url))
      .filter((file) => /termcn/i.test(readFileSync(file, 'utf8')))
      .map((file) => relative(packageDir, file));
    expect(offenders).toEqual([]);
  });

  it('ships no third-party licence directory', () => {
    expect(existsSync(join(packageDir, 'THIRD_PARTY_LICENSES'))).toBe(false);
  });
});

describe('the form kernel is PURE (BB-236 AC-1 / Decision 7)', () => {
  const formDir = join(srcDir, 'Form');

  it('has files to guard (the guard cannot pass by finding nothing)', () => {
    expect(tsFiles(formDir).length).toBeGreaterThan(0);
  });

  it('no file under src/Form/ imports anything outside Form/', () => {
    const offenders: string[] = [];
    for (const file of tsFiles(formDir)) {
      for (const spec of specifiers(file)) {
        // A sibling inside `Form/` is `./x.js`; anything reaching up (`../`) or naming
        // a package leaves the kernel. `node:*` is I/O by definition.
        const inside = spec.startsWith('./') && !spec.includes('/../');
        if (!inside) {
          offenders.push(`${relative(packageDir, file)} → ${spec}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('no file OUTSIDE src/Form/ is imported by it, checked the other way round too', () => {
    // Belt and braces: resolve each kernel import to a real path and assert it lands
    // inside `Form/`, so a `./`-prefixed specifier cannot smuggle an escape.
    const offenders: string[] = [];
    for (const file of tsFiles(join(srcDir, 'Form'))) {
      for (const spec of specifiers(file)) {
        const resolved = join(dirname(file), spec.replace(/\.js$/, '.ts'));
        if (!resolved.startsWith(join(srcDir, 'Form') + sep)) {
          offenders.push(`${relative(packageDir, file)} → ${spec}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('a DATA SERVICE knows nothing about forms (BB-236)', () => {
  // The converse of kernel purity, and the invariant the third re-cut exists to
  // establish: `Option` is form vocabulary, so a service returning it is coupled to
  // the popup that consumes it. Left to convention the arrow pointed the wrong way
  // in both earlier cuts, so it is asserted mechanically. Only the two adapters
  // (`create-form-data.ts` / `edit-form-data.ts`) may build that vocabulary — the
  // one thing a data module may do is NAME its own slice's payload type, which G7
  // below holds to type-only and to a named list.
  const formDir = join(srcDir, 'Form');
  // Retargeted onto the entity slices as each phase moves them (BB-236 phase 1).
  // This stays a NAMED-FILE check even though G3 now covers the same ground
  // structurally: the named list is what fails loudly if one of these four is
  // deleted or renamed away, where a path glob would just stop matching it.
  const dataServices = [
    join(srcDir, 'Entity', 'transport.ts'),
    join(srcDir, 'Entity', 'user', 'Data', 'users.ts'),
    join(srcDir, 'Entity', 'conductor', 'Data', 'conductors.ts'),
    join(srcDir, 'Entity', 'term', 'Data', 'terms.ts'),
  ];

  it('has the data services to guard (the guard cannot pass by finding nothing)', () => {
    expect(dataServices.filter((f) => existsSync(f))).toEqual(dataServices);
  });

  it('no data service imports from src/Form/', () => {
    const offenders: string[] = [];
    for (const file of dataServices.filter((f) => existsSync(f))) {
      for (const spec of specifiers(file)) {
        const resolved = join(dirname(file), spec.replace(/\.js$/, '.ts'));
        if (resolved === formDir || resolved.startsWith(formDir + sep)) {
          offenders.push(`${relative(packageDir, file)} → ${spec}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// BB-236 entity slices (acceptance v4 AC-18) — the slice boundary guards.
//
// Written against the TARGET layout during phase 0, so they bound whatever already
// lived under `src/Entity/` and tightened as each phase landed. The EXISTENCE
// assertions were deferred on purpose — until the slices existed, every rule below
// them passed vacuously, and a vacuous pass is not evidence. They are ARMED now
// (first describe block), so the layout itself is under test and a slice cannot be
// quietly dissolved back into a flat drawer.
// ---------------------------------------------------------------------------

const entityDir = join(srcDir, 'Entity');
const formDirPath = join(srcDir, 'Form');
const CONCERNS = ['Data', 'Form', 'Component', 'Screen'];

/**
 * The slice a file belongs to, or `undefined` when it is not in one.
 *
 * A file sitting DIRECTLY under `Entity/` belongs to no slice — that is
 * `Entity/transport.ts`, the shared read primitive every slice reads through. Without
 * the segment check its filename would read as a slice name and every legitimate
 * `Data/ → transport` import would look like a cross-slice edge.
 */
function sliceOf(abs: string): string | undefined {
  if (!abs.startsWith(entityDir + sep)) return undefined;
  const segments = relative(entityDir, abs).split(sep);
  return segments.length > 1 ? segments[0] : undefined;
}

/** The concern directory a file sits in within its slice. */
function concernOf(abs: string): string | undefined {
  if (!abs.startsWith(entityDir + sep)) return undefined;
  return relative(entityDir, abs).split(sep)[1];
}

/** Resolve a relative import to the source file it names. */
function resolve(file: string, spec: string): string | undefined {
  if (!spec.startsWith('.')) return undefined;
  return join(dirname(file), spec.replace(/\.js$/, '.ts'));
}

describe('entity slices: the target layout EXISTS — AC-15/AC-16/AC-17', () => {
  // The arming assertions the migration deferred: until the slices existed, every
  // rule below them passed vacuously, and a vacuous pass is not evidence. These make
  // the layout itself the thing under test, so a slice cannot be quietly dissolved
  // back into a flat drawer.
  //
  // BB-391 (AC4) — `team` is the SEVENTH slice, and it is argued the same way.
  // It mirrors a resource the control plane serves (`bb_team`, BB-321) and it
  // is a clean G2 leaf: its `Data/` reads `bb_team` and `og_membership` and
  // imports nothing from another slice.
  // BB-472 — `workspace` is the EIGHTH slice, argued the same way: it mirrors
  // a resource the control plane serves (`bb_workspace`), and it is a clean
  // G2 leaf — its `Data/` reads `bb_workspace` alone and imports nothing
  // from another slice.
  // `ticket-template` is the NINTH slice, argued the same way: it mirrors
  // `bb_ticket_template`, and its `Data/` reads that type alone; the create
  // popup's adapter in `ticket/Form/` maps its rows, not the other way round.
  const SLICES = [
    'conductor',
    'project',
    'run',
    'team',
    'term',
    'ticket',
    'ticket-template',
    'user',
    'workspace',
  ];

  it('all nine entity slices exist', () => {
    expect(subDirs(entityDir).sort()).toEqual(SLICES);
  });

  it('the shared read primitive sits directly under Entity/, in no slice', () => {
    expect(existsSync(join(entityDir, 'transport.ts'))).toBe(true);
    expect(sliceOf(join(entityDir, 'transport.ts'))).toBeUndefined();
  });

  it('Service/ and Deriver/ are GONE, not left as husks', () => {
    expect(existsSync(join(srcDir, 'Service'))).toBe(false);
    expect(existsSync(join(srcDir, 'Deriver'))).toBe(false);
  });

  it('every slice has at least one concern directory, and none is empty', () => {
    // AC-16: a concern directory exists only when populated — no scaffolding for
    // symmetry's sake.
    for (const slice of SLICES) {
      const concerns = subDirs(join(entityDir, slice));
      expect(concerns.length).toBeGreaterThan(0);
      for (const concern of concerns) {
        expect(tsFiles(join(entityDir, slice, concern)).length).toBeGreaterThan(
          0,
        );
      }
    }
  });
});

describe('shared widgets', () => {
  it('has no Vendor tree: shared widgets are ordinary components', () => {
    expect(existsSync(join(srcDir, 'Vendor'))).toBe(false);
  });
});

describe('entity slices: the import graph is acyclic — G1 (AC-18)', () => {
  it('no cycle among Entity/* slices', () => {
    const edges = new Map<string, Set<string>>();
    for (const file of tsFiles(entityDir)) {
      const from = sliceOf(file);
      if (from === undefined) continue;
      for (const spec of specifiers(file)) {
        const target = resolve(file, spec);
        const to = target === undefined ? undefined : sliceOf(target);
        if (to !== undefined && to !== from) {
          const set = edges.get(from) ?? new Set<string>();
          set.add(to);
          edges.set(from, set);
        }
      }
    }
    const state = new Map<string, 'open' | 'done'>();
    const cycles: string[] = [];
    const walk = (node: string, trail: string[]): void => {
      if (state.get(node) === 'open') {
        cycles.push([...trail, node].join(' → '));
        return;
      }
      if (state.get(node) === 'done') return;
      state.set(node, 'open');
      for (const next of edges.get(node) ?? []) walk(next, [...trail, node]);
      state.set(node, 'done');
    };
    for (const node of edges.keys()) walk(node, []);
    expect(cycles).toEqual([]);
  });
});

describe('entity slices: Data/ is a leaf — G2 (AC-18)', () => {
  // The rule that holds in EVERY slice, composite ones included: a data module
  // imports only its own slice's Data/, Entity/transport, types and lib/. The two
  // allowances below are enumerated AS DATA on purpose — a path rule with a hidden
  // escape hatch is worse than a file list, so a third entry has to be argued in
  // review rather than slipped in.
  const ALLOWED_CROSS_SLICE: ReadonlyArray<readonly [string, string]> = [
    ['project', 'ticket'],
    // A team workload is derived from the tickets assigned to its active crew.
    ['team', 'ticket'],
    ['project', 'conductor'],
  ];

  // BB-257 (re-entry): `Widget/` joins the forbidden targets. It is the same
  // rule, extended to the layer that did not exist when it was written — a data
  // service that implemented an `OptionSource` would be coupled to the popup
  // consuming it exactly as one returning an `Option` was, which is the arrow
  // this guard exists to keep pointing the other way. Only a slice's `Form/`
  // (the adapter that legitimately knows both sides) may declare a source.
  it('no file under Entity/*/Data/ reaches into another slice, Form/, Widget/, Component/, Kernel/ or Screen/', () => {
    const offenders: string[] = [];
    for (const file of tsFiles(entityDir)) {
      if (concernOf(file) !== 'Data') continue;
      const from = sliceOf(file);
      for (const spec of specifiers(file)) {
        const target = resolve(file, spec);
        if (target === undefined) continue;
        const to = sliceOf(target);
        const crossSlice = to !== undefined && to !== from;
        const allowed =
          crossSlice &&
          ALLOWED_CROSS_SLICE.some(
            ([a, b]) => a === from && b === to && concernOf(target) === 'Data',
          );
        const reachesForm = [formDirPath, join(srcDir, 'Widget')].some(
          (d) => target === d || target.startsWith(d + sep),
        );
        const reachesShell = ['Kernel', 'Screen'].some((d) =>
          target.startsWith(join(srcDir, d) + sep),
        );
        // Own-slice Component/ is forbidden too: Data/ never renders.
        const reachesComponent = concernOf(target) === 'Component';
        if (
          (crossSlice && !allowed) ||
          reachesForm ||
          reachesShell ||
          reachesComponent
        ) {
          offenders.push(`${relative(packageDir, file)} → ${spec}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('entity slices: a Data/ module may NAME its slice`s payload, not run it — G7 (BB-309)', () => {
  // The rule the file stated in prose and did not check. G2 above forbids a data
  // module the shared kernel and every other slice, and permits its OWN slice's
  // `Form/` structurally. `Entity/ticket/Data/write.ts` used that for the create
  // body; with ticket creation gone from `bakers ui`, no data module needs it.
  //
  // Two assertions, so the permission stays a decision: WHO does it, and HOW.
  // Type-only is the load-bearing half — a data module that could call into the
  // kernel would be the coupling the guard above exists to prevent, while one
  // that names a type cannot execute a line of it.
  const OWN_SLICE_FORM_IMPORTERS: string[] = [];

  const ownSliceFormImports = (): { file: string; typeOnly: boolean }[] => {
    const found: { file: string; typeOnly: boolean }[] = [];
    for (const file of tsFiles(entityDir)) {
      if (concernOf(file) !== 'Data') continue;
      for (const { spec, typeOnly } of imports(file)) {
        const target = resolve(file, spec);
        if (target === undefined) continue;
        if (sliceOf(target) !== sliceOf(file)) continue;
        if (concernOf(target) !== 'Form') continue;
        found.push({ file: relative(packageDir, file), typeOnly });
      }
    }
    return found;
  };

  it('exactly the NAMED data modules reach their own slice`s Form/', () => {
    expect(
      ownSliceFormImports()
        .map((f) => f.file)
        .sort(),
    ).toEqual(
      OWN_SLICE_FORM_IMPORTERS.map((f) => f.split('/').join(sep)).sort(),
    );
  });

  it('and each of them names it TYPE-ONLY, so no kernel code can be called', () => {
    expect(ownSliceFormImports().filter((f) => !f.typeOnly)).toEqual([]);
  });
});

describe('entity slices: exactly four concerns — G2b (AC-16/AC-18)', () => {
  it('every directory directly under Entity/<slice>/ is Data, Form, Component or Screen', () => {
    const offenders: string[] = [];
    for (const slice of subDirs(entityDir)) {
      for (const dir of subDirs(join(entityDir, slice))) {
        if (!CONCERNS.includes(dir)) offenders.push(`Entity/${slice}/${dir}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('entity slices: only a slice Form/ reaches the kernel — G3 (AC-18)', () => {
  // Pre-move leftovers, shrinking to empty. It reached empty in phase 4: all four
  // ticket form modules now live under Entity/ticket/Form/, which G3 permits
  // structurally, so no file needs excusing any more. Kept as an empty list plus the
  // assertion below, so the fact that nothing is excused is itself asserted rather
  // than left to a reader noticing the list is gone.
  const PRE_MOVE: string[] = [];

  it('nothing is excused from G3 any more (the pre-move list reached empty)', () => {
    expect(PRE_MOVE).toEqual([]);
  });

  // BB-257 (re-entry) — G3 gains its SECOND legitimate kernel consumer, and the
  // change is deliberate rather than a concession to a layout.
  //
  // A widget renders ONE field kind. Its whole vocabulary — `FieldDecl`, `Option`,
  // `FieldKind`, and above all `filterOptions`, which the suggestion list must
  // share with the reducer or `›` points at a row Enter does not take — is the
  // kernel's. A widget that could not name those types would have to re-declare
  // them, which is the duplication the layer exists to remove. So `src/Widget/`
  // is permitted here, and the boundary it must still respect is asserted
  // separately and no less mechanically by G6 below: the widget layer imports the
  // kernel and `lib/` and nothing else, so admitting it to G3 widens the kernel's
  // audience by exactly one ENTITY-AGNOSTIC directory, not by a back door into
  // `Entity/`.
  const widgetDirPath = join(srcDir, 'Widget');

  it('src/Form/ is imported only from Entity/*/Form/, Kernel/, Widget/ or a listed pre-move file', () => {
    const offenders: string[] = [];
    for (const file of tsFiles(srcDir)) {
      if (file.startsWith(formDirPath + sep)) continue;
      if (file.startsWith(join(srcDir, 'Kernel') + sep)) continue;
      if (file.startsWith(widgetDirPath + sep)) continue;
      if (PRE_MOVE.includes(file)) continue;
      if (concernOf(file) === 'Form') continue;
      for (const spec of specifiers(file)) {
        const target = resolve(file, spec);
        if (target === undefined) continue;
        if (target === formDirPath || target.startsWith(formDirPath + sep)) {
          offenders.push(`${relative(packageDir, file)} → ${spec}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('shared code stays entity-agnostic — G4 (AC-18)', () => {
  // Pre-move leftovers, shrinking to empty: per Decision 5 only `section-list` and
  // `top-tabs` are genuinely shared. The rest are slice-owned components still
  // sitting in the shared drawer until their phase moves them, so they are listed
  // here rather than excused by a looser rule — the last phase asserts this list is
  // empty, which is the same device G3 uses.
  // Reached EMPTY in phase 5: `agent-list` moved to `Agent/Component/`, so every
  // component still under the shared drawer is genuinely shared — `section-list` and
  // `top-tabs`, and nothing else. Kept as an empty list with the assertion below, so
  // "nothing is excused" is asserted rather than inferred from the list's absence.
  const PENDING_SLICE_COMPONENTS: string[] = [];

  it('nothing is excused from G4 any more (the pending list reached empty)', () => {
    expect(PENDING_SLICE_COMPONENTS).toEqual([]);
    // And the shared drawer really is down to the entity-agnostic components.
    //
    // BB-256 spec D11 adds the THIRD, `stats-panel`, and it belongs here for the
    // reason this list exists: it is genuinely shared. Its types are
    // `{ label, numbers }` — no ticket, run, project or user vocabulary anywhere —
    // which is what lets the Dashboard render four different blocks from one
    // function, and what the second assertion in this describe block checks
    // structurally rather than on trust. The RULE is not weakened: the list exists
    // so that adding a member is a decision, and this is the decision.
    //
    // BB-372 D11 adds the FOURTH, `markdown`, and it is a decision of the same
    // kind. It is genuinely shared and demonstrably so: TWO entity slices reach it
    // — `Entity/ticket` for the `Description`, `Comments` and `Latest summary`
    // bodies, and `Entity/run` for the run log's own ATX-only rule — and its
    // vocabulary is `body`/`line`/`run`, with no ticket, run, project or user
    // notion in it. It exists because the alternative was worse: the span-kind →
    // attribute/palette mapping was sitting inside `lib/vnode.ts`, so the package's
    // most-shared render primitive carried Markdown domain knowledge, and the
    // second assertion in this describe block could not see it (both files were in
    // `lib/`, and `scripts/assert-acyclic.mjs` checks PACKAGE edges).
    //
    // BB-582 adds SIX at once — `badge`, `bar-chart`, `card`, `divider`,
    // `heat-map` and `key-value` — and each is the same kind of decision. They
    // are the presentation widgets the ticket content and the Stats figure
    // cards paint with, and they used to sit in a separate third-party tree
    // that the rest of the package could only reach through a named allow-list.
    // None of them carries ticket, run, project or user vocabulary (a card, a
    // rule, a key/value list, a heat grid, bars, a label), and `card` and
    // `heat-map` already serve two owners in different layers — `Statistics/`
    // may not import `Entity/`, so neither could live with one owner. The
    // second assertion below holds them to the same no-entity rule as the rest.
    //
    // Statistics left `bakers ui`, and `stats-panel`, `bar-chart` and `heat-map`
    // with it: they had no other owner.
    expect(subDirs(join(srcDir, 'Component')).sort()).toEqual([
      'badge',
      'card',
      'divider',
      'footer-actions',
      'key-value',
      'list-chrome',
      'markdown',
      'section-list',
      'team-member-workload-list',
      'top-tabs',
      'work-ticket-list',
      'workload-summary',
    ]);
  });

  it('shared Component/ and lib/ import nothing from Entity/, Agent/, Kernel/ or Screen/', () => {
    const forbidden = ['Entity', 'Agent', 'Kernel', 'Screen'].map((d) =>
      join(srcDir, d),
    );
    const offenders: string[] = [];
    for (const dir of ['Component', 'lib']) {
      for (const file of tsFiles(join(srcDir, dir))) {
        // A slice-owned component lives under Entity/, not here, so everything
        // scanned in this loop is either shared or a listed pre-move leftover.
        if (PENDING_SLICE_COMPONENTS.some((p) => file.startsWith(p + sep))) {
          continue;
        }
        for (const spec of specifiers(file)) {
          const target = resolve(file, spec);
          if (target === undefined) continue;
          if (
            forbidden.some((f) => target === f || target.startsWith(f + sep))
          ) {
            offenders.push(`${relative(packageDir, file)} → ${spec}`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('the kernel is a sink — G5 (AC-18)', () => {
  it('only entity-local screens import shared Screen contracts; nothing imports Kernel', () => {
    const shell = ['Kernel', 'Screen'].map((d) => join(srcDir, d));
    const offenders: string[] = [];
    for (const dir of ['Entity', 'Agent', 'Component', 'Widget', 'lib']) {
      for (const file of tsFiles(join(srcDir, dir))) {
        for (const spec of specifiers(file)) {
          const target = resolve(file, spec);
          if (target === undefined) continue;
          const importsShell = shell.some(
            (s) => target === s || target.startsWith(s + sep),
          );
          const entityLocalScreen =
            file.startsWith(entityDir + sep) &&
            relative(entityDir, file).split(sep)[1] === 'Screen';
          const importsSharedScreen =
            target === join(srcDir, 'Screen') ||
            target.startsWith(join(srcDir, 'Screen') + sep);
          if (importsShell && !(entityLocalScreen && importsSharedScreen)) {
            offenders.push(`${relative(packageDir, file)} → ${spec}`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// BB-257 (re-entry) — the WIDGET layer.
//
// The review returned the ticket on a structural verdict: the addon had no
// widget layer, so loading and rendering leaked into the layers on either side
// of it and the two popups shared nothing. The guards below are what stop that
// from happening again, and they are stated here — beside the slice guards they
// extend — rather than in a file of their own.
//
// WHERE the layer lives, and why it is NOT `src/Form/Widget/` as the review's
// sketch put it: a widget calls no service, but it does measure display columns
// (`lib/width`) and window a cursor list (`lib/scroll`), and `src/Form/` is
// guarded as a SINK that imports nothing outside itself. Putting the widgets
// inside it would have meant weakening that guard — the one rule that makes the
// form kernel provably pure. Nor is it a fourth `Entity/<slice>/` concern: a
// widget renders a KIND, which is kernel vocabulary and carries no entity
// knowledge at all, so a per-slice home would have forced the create and edit
// popups to own separate copies — the very duplication the layer removes. It
// therefore sits beside the other two entity-agnostic shared drawers,
// `src/Component/` and `src/lib/`, and G6 asserts it stays that way.
// ---------------------------------------------------------------------------

const widgetDir = join(srcDir, 'Widget');

describe('the widget layer is entity-agnostic — G6 (BB-257 AC-15)', () => {
  it('the layer EXISTS and has files to guard', () => {
    expect(existsSync(widgetDir)).toBe(true);
    expect(tsFiles(widgetDir).length).toBeGreaterThan(0);
  });

  it('src/Widget/ imports only the form kernel, lib/, the shared types and itself', () => {
    const allowed = [widgetDir, formDirPath, join(srcDir, 'lib')];
    const offenders: string[] = [];
    for (const file of tsFiles(widgetDir)) {
      for (const spec of specifiers(file)) {
        const target = resolve(file, spec);
        // A bare package specifier is a dependency, not a layering question; the
        // dropsh guard above already covers the one that would matter.
        if (target === undefined) continue;
        if (target === join(srcDir, 'types.ts')) continue;
        if (allowed.some((a) => target === a || target.startsWith(a + sep))) {
          continue;
        }
        offenders.push(`${relative(packageDir, file)} → ${spec}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('lib/ stays a leaf below it: nothing under lib/ imports Widget/', () => {
    const offenders: string[] = [];
    for (const file of tsFiles(join(srcDir, 'lib'))) {
      for (const spec of specifiers(file)) {
        const target = resolve(file, spec);
        if (target === undefined) continue;
        if (target === widgetDir || target.startsWith(widgetDir + sep)) {
          offenders.push(`${relative(packageDir, file)} → ${spec}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('a field declaration stays plain, printable DATA — no function on a field', () => {
    // The constraint that decided the layout: had a widget hung off `FieldDecl`
    // as a provider function, the kernel would have had to reach a service and
    // its purity guard would have had to go. The registry is keyed by `kind`
    // instead, so a declaration remains something a renderer can walk and a
    // reader can print.
    const source = readFileSync(join(formDirPath, 'field.ts'), 'utf8');
    const decl = source.slice(
      source.indexOf('export interface FieldDecl'),
      source.indexOf('// The typed key sets'),
    );
    expect(decl.length).toBeGreaterThan(0);
    expect(decl).not.toMatch(/=>/);
    expect(decl).not.toMatch(/\bFunction\b/);
  });
});

// ---------------------------------------------------------------------------
// The popup components, held to what the widget layer took off them.
// ---------------------------------------------------------------------------

const POPUPS = [
  join(srcDir, 'Entity', 'ticket', 'Component', 'edit-form', 'index.ts'),
];

/**
 * A file's CODE, with its comments removed.
 *
 * Every guard below reads source for a token, and a token in a comment is the
 * opposite of a violation: this package's culture is to write down what was
 * removed and why, so `edit-form/index.ts` opens by naming the `labelOf` and the
 * private `wrap()` it no longer has. A guard that punished that would be a guard
 * against documentation. Block comments and whole-line `//` comments go; nothing
 * else is touched, so a string literal cannot be mangled by a `//` inside it.
 */
function codeOf(file: string): string {
  return readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*)/.test(line))
    .join('\n');
}

describe('a popup component adds chrome and nothing else — AC-10/AC-13', () => {
  it('the popup component exists (the guard cannot pass by finding nothing)', () => {
    expect(POPUPS.filter((f) => existsSync(f))).toEqual(POPUPS);
  });

  it('no popup component carries rendering that belongs to a KIND', () => {
    // Every token below is a kind's own: the checkbox and the multiselect cursor,
    // the autocomplete caret and its kernel filter, the select ring's two
    // vocabularies, the text placeholder, the active marker, and the window
    // arithmetic the suggestion list needs. A popup that spells any of them is a
    // popup that has started rendering a kind again.
    const KIND_OWNED = [
      '[x]',
      '[ ]',
      '▌',
      '▸',
      '<empty>',
      '— none —',
      '(none available)',
      'filterOptions',
      'scrollTo',
      'truncateToWidth',
    ];
    const offenders: string[] = [];
    for (const file of POPUPS) {
      const source = codeOf(file);
      for (const token of KIND_OWNED) {
        if (source.includes(token)) {
          offenders.push(`${relative(packageDir, file)}: ${token}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('no popup component writes a declared field`s row label out by hand', () => {
    // AC-11: the popup walks its declaration, so every label it draws comes from
    // a `FieldDecl`. A literal `Assignee:` in a component is a hand-written row.
    const offenders: string[] = [];
    for (const file of POPUPS) {
      const source = codeOf(file);
      for (const label of [
        'Description',
        'Parent',
        'Assignee',
        'Conductor',
        'Labels',
        'Workflow',
        'Create ticket',
        'Estimate',
        'Spent',
        'Save',
      ]) {
        if (source.includes(`${label}:`)) {
          offenders.push(`${relative(packageDir, file)}: ${label}:`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the EDIT popup keeps no private wrap and no private option lookup', () => {
    // The latent defect the review named: `edit-form` measured its wrap in UTF-16
    // code units while every other measurement in the package is in display
    // columns, so a server message carrying CJK or an emoji wrapped past the
    // frame. It is not a style point — it is a second unit of measure.
    const source = codeOf(POPUPS[0] as string);
    expect(source).not.toMatch(/function wrap\b/);
    expect(source).not.toMatch(/\blabelOf\b/);
    expect(source).not.toMatch(/\bmark\(\d/);
  });
});

describe('one unit of measure: display columns — AC-14', () => {
  it('no popup component or widget measures TEXT in UTF-16 code units', () => {
    // `rows.length` / `matches.length` are collection sizes and stay. What must
    // not appear is `.length` on a STRING, which is the unit that made the edit
    // popup wrap a wide character one column short — and, harmlessly today but in
    // the same unit class, indented the `⚠` note and clipped the Parent row.
    const TEXT_VARIABLES =
      /\b(indent|prefix|head|parentHead|label|text|message|query|line|word|paragraph|caret|value|title|note|body)\.length\b/;
    const offenders: string[] = [];
    for (const file of [...POPUPS, ...tsFiles(widgetDir)]) {
      const hit = TEXT_VARIABLES.exec(codeOf(file));
      if (hit) offenders.push(`${relative(packageDir, file)}: ${hit[0]}`);
    }
    expect(offenders).toEqual([]);
  });
});

describe('the kernel drives fields generically — AC-12', () => {
  it('src/Kernel/tui-kernel.ts names no field of any popup declaration', () => {
    // The third of the three loading paths. The kernel owned the Parent field's
    // debounce, its cancel token, its bag swap, its error merge and two state
    // variables that existed only because the field could not reload itself.
    // With the field's source declared in the slice and driven by the generic
    // option loader, the kernel has no reason left to know the word.
    const hits =
      codeOf(join(srcDir, 'Kernel', 'tui-kernel.ts')).match(/parent/gi) ?? [];
    expect(hits).toEqual([]);
  });
});

describe('BB-375 FullScreen stack — Entity screens', () => {
  it('Entity Screen modules do not import framedPanel (frame is region-body)', () => {
    const entity = join(srcDir, 'Entity');
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (path.includes(`${sep}Screen${sep}`) && path.endsWith('.ts')) {
          files.push(path);
        }
      }
    };
    walk(entity);
    expect(files.length).toBeGreaterThan(5);
    for (const file of files) {
      const src = readFileSync(file, 'utf8');
      expect(src, relative(srcDir, file)).not.toMatch(/\bframedPanel\b/);
      expect(src, relative(srcDir, file)).not.toMatch(/\bscreenBody\b/);
      // Chrome comes from FullScreen / AsyncModalScreen — not hand-rolled.
      expect(src, relative(srcDir, file)).not.toMatch(/\boverride present\b/);
      expect(src, relative(srcDir, file)).not.toMatch(/\bpresentation\s*\(/);
      expect(src, relative(srcDir, file)).not.toMatch(
        /extends\s+(FullScreen|BaseScreen|ModalScreen)\b/,
      );
    }
  });
});
