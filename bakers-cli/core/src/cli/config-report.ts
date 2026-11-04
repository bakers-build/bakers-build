import { shellQuote } from '../core/shell.js';

export type ConfigScope = 'machine' | 'connection' | 'project' | 'all';
export type ConfigLayer = Exclude<ConfigScope, 'all'>;
export type ConfigOperation = 'init' | 'upgrade' | 'check';
export type ConfigFileKind =
  | 'machine'
  | 'connection'
  | 'project-connection'
  | 'conductor'
  | 'local';
export type ConfigFindingCode =
  | 'scope_required'
  | 'invalid_scope'
  | 'project_required'
  | 'missing_required_file'
  | 'missing_required_key'
  | 'unreadable_file'
  | 'syntax_error'
  | 'unsupported_source_shape'
  | 'unknown_value'
  | 'invalid_value'
  | 'version_marker_disagreement'
  | 'unsupported_schema_version'
  | 'misplaced_key'
  | 'conflicting_values'
  | 'out_of_scope_write_required'
  | 'changed_since_planning'
  | 'authentication_failure'
  | 'no_workspace'
  | 'cancelled_selection'
  | 'superseded_file'
  | 'dead_key'
  | 'retired_key'
  | 'addon_scope_not_allowed'
  | 'addon_scope_skipped'
  | 'addon_with_invalid'
  | 'write_failure';

export interface ConfigLocation {
  path: string;
  key: string | null;
  line?: number;
  column?: number;
}

export interface ConfigFinding extends ConfigLocation {
  code: ConfigFindingCode;
  severity: 'error' | 'warning' | 'info';
  stage:
    | 'scope'
    | 'inventory'
    | 'syntax'
    | 'schema'
    | 'ownership'
    | 'planning'
    | 'online'
    | 'write';
  expected: string;
  observed: string | number | boolean | null;
  owner: ConfigLayer;
  related: ConfigLocation[];
  statically_determined: boolean;
  remediation: string;
  recheck: string;
}

export interface ConfigFileReport {
  path: string;
  layer: ConfigLayer;
  kind: ConfigFileKind;
  role: 'primary' | 'supplementary';
  selected: boolean;
  required: boolean;
  state:
    | 'absent'
    | 'unreadable'
    | 'malformed'
    | 'unsupported'
    | 'partial'
    | 'computed'
    | 'valid';
  fingerprint: string | null;
  version: {
    header: number | null;
    field: number | null;
    effective: number | null;
    current: number | null;
  };
}

export interface ConfigChange {
  path: string;
  layer: ConfigLayer;
  before_version: number | null;
  after_version: number | null;
  diff: string;
}

export interface ConfigReport {
  report_version: 1;
  operation: ConfigOperation;
  requested_scope: string | null;
  resolved_scopes: ConfigLayer[];
  project: string | null;
  roots: { machine: string; connection: string; project: string | null };
  files: ConfigFileReport[];
  changes: ConfigChange[];
  findings: ConfigFinding[];
  connection_resolution: {
    id: string;
    selected_by: string;
    path: string;
    fields: Array<{
      key: string;
      value:
        | string
        | number
        | boolean
        | null
        | unknown[]
        | Record<string, unknown>;
      source: string;
    }>;
  } | null;
  result: 'ok' | 'blocked' | 'incomplete' | 'failed';
  /** Present when machine scope is inspected. `null` means unresolved, never an implicit opt-in. */
  machine_policy?: { tunnel: boolean | null; source: string };
  verification: {
    offline: { status: 'passed' | 'blocked' | 'incomplete' };
    online: {
      status: 'pending' | 'not_applicable' | 'passed' | 'failed';
      reason: string;
      connections?: Array<{
        path: string;
        status: 'passed' | 'failed' | 'skipped';
      }>;
    };
    readiness: 'unverified' | 'ready' | 'not_applicable';
    skipped: Array<{ path: string; stage: string; reason: string }>;
  };
}

/** Exact shell-safe recheck command; the project root never relocates home files. */
export function configRecheckCommand(
  scope: ConfigScope,
  projectRoot?: string | null,
): string {
  return `bakers config check --scope ${scope}${projectRoot && (scope === 'all' || scope === 'project') ? ` --path ${shellQuote(projectRoot)}` : ''}`;
}

/** Recompute after adding planner/online findings; never imply online readiness. */
export function finalizeConfigReport(report: ConfigReport): ConfigReport {
  const errors = report.findings.some(
    (finding) => finding.severity === 'error',
  );
  const unknown = report.findings.some(
    (finding) =>
      finding.code === 'unknown_value' ||
      finding.code === 'unsupported_source_shape',
  );
  const failed = report.findings.some(
    (finding) =>
      finding.code === 'write_failure' ||
      (finding.stage === 'online' && finding.severity === 'error'),
  );
  report.result = failed
    ? 'failed'
    : errors
      ? 'blocked'
      : unknown
        ? 'incomplete'
        : 'ok';
  const offlineErrors = report.findings.some(
    (finding) =>
      finding.severity === 'error' &&
      finding.stage !== 'online' &&
      finding.stage !== 'write',
  );
  report.verification.offline.status = offlineErrors
    ? 'blocked'
    : unknown
      ? 'incomplete'
      : 'passed';
  return report;
}
