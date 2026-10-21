import { type ConfigSourceProperty, inspectConfigSource } from '@bakers-build/core';

/** Small span editor. Every operation re-parses so offsets never become stale. */
export class ConfigSourceEditor {
  constructor(public text: string) {}
  get source() {
    return inspectConfigSource(this.text);
  }
  property(key: string) {
    return this.source.properties.get(key);
  }
  expression(key: string) {
    const p = this.property(key);
    return p ? this.text.slice(p.valueStart, p.valueEnd) : undefined;
  }
  replace(start: number, end: number, value: string) {
    this.text = this.text.slice(0, start) + value + this.text.slice(end);
  }
  set(key: string, value: string) {
    const existing = this.property(key);
    if (existing) {
      this.replace(existing.valueStart, existing.valueEnd, value);
      return;
    }
    const dot = key.lastIndexOf('.');
    const parentKey = dot < 0 ? null : key.slice(0, dot);
    const name = dot < 0 ? key : key.slice(dot + 1);
    const source = this.source;
    const parent = parentKey ? source.properties.get(parentKey) : undefined;
    if (parentKey && !parent) {
      this.set(
        parentKey,
        `{ ${/^[A-Za-z_$][\w$]*$/.test(name) ? name : JSON.stringify(name)}: ${value} }`,
      );
      return;
    }
    const start = parent ? parent.valueStart : source.object?.start;
    if (
      start === undefined ||
      (parent && parent.nodeType !== 'ObjectExpression')
    )
      throw new Error('Unsupported insertion');
    this.replace(
      start + 1,
      start + 1,
      `\n  ${/^[A-Za-z_$][\w$]*$/.test(name) ? name : JSON.stringify(name)}: ${value},`,
    );
  }
  remove(key: string) {
    const p = this.property(key);
    if (!p) return;
    let end = p.end;
    while (/\s/.test(this.text[end] ?? '') && end < this.text.length) end++;
    if (this.text[end] === ',') this.replace(p.start, end + 1, '');
    else {
      let start = p.start - 1;
      while (start >= 0 && /\s/.test(this.text[start] ?? '')) start--;
      this.replace(this.text[start] === ',' ? start : p.start, p.end, '');
    }
  }
  rename(key: string, next: string) {
    const p = this.property(key);
    if (!p) return;
    const colon = this.text.indexOf(':', p.start);
    if (colon < 0 || colon >= p.valueStart) throw new Error('Unsupported key');
    this.replace(p.start, colon, next);
  }
  stamp(version: number) {
    this.set('schema_version', String(version));
    this.text = this.text
      .replace(/^\s*\/\/ @bakers-schema-version \d+\s*$/gm, '')
      .replace(/^\n/, '');
    this.text = `// @bakers-schema-version ${version}\n${this.text}`;
  }
}
export function sameValue(a: ConfigSourceProperty, b: ConfigSourceProperty) {
  return (
    a.staticallyDetermined &&
    b.staticallyDetermined &&
    a.value !== undefined &&
    a.value === b.value
  );
}

/** Hide all computed source and every credential-bearing statement in previews. */
export function redactConfigSource(text: string): string {
  const editor = new ConfigSourceEditor(text);
  const source = editor.source;
  if (source.syntax !== 'valid' || !source.object) return '[SOURCE REDACTED]';
  const spans = source.propertyOccurrences.filter(
    (p) =>
      /secret|token|password|credential|client_id|authorization|url/i.test(
        p.key,
      ) ||
      (!p.staticallyDetermined &&
        !['ObjectExpression', 'ArrayExpression'].includes(p.nodeType)),
  );
  const outer = spans.filter(
    (p) =>
      !spans.some(
        (q) =>
          q !== p && q.valueStart <= p.valueStart && q.valueEnd >= p.valueEnd,
      ),
  );
  for (const p of outer.sort((a, b) => b.valueStart - a.valueStart))
    editor.replace(p.valueStart, p.valueEnd, "'[REDACTED]'");
  const clean = editor.source;
  return `[Module preamble redacted]\nexport default ${editor.text.slice(clean.object?.start, clean.object?.end)};`;
}
