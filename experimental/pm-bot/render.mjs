// Fill each dollar-brace placeholder of a template from the environment. The container's
// entrypoint renders config.template.yaml and the skill's project reference with it on every
// start:
//
//   node render.mjs <template> <output>
//
// An unset value stops the render, and so does one that could change the YAML's structure:
// values are single words of URL and path characters, so no space, newline, quote, comment or
// flow character gets in. The output is written only when every placeholder renders.
import { renameSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const SAFE = /^[A-Za-z0-9./][A-Za-z0-9._~:/,@+=%-]*$/;

/**
 * @param {string} template
 * @param {Record<string, string | undefined>} env
 * @returns {string}
 */
export function render(template, env) {
  return template.replace(/\$\{(\w+)\}/g, (_, key) => {
    const value = env[key];
    if (value === undefined || value === '') throw new Error(`${key} is not set`);
    if (!SAFE.test(value)) {
      throw new Error(`${key} may hold only letters, digits and . _ ~ : / , @ + = % -, starting with a letter, digit, / or .`);
    }
    return value;
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [source, target] = process.argv.slice(2);
  if (!source || !target) {
    console.error('usage: node render.mjs <template> <output>');
    process.exit(2);
  }
  try {
    writeFileSync(`${target}.tmp`, render(readFileSync(source, 'utf8'), process.env), { mode: 0o600 });
    renameSync(`${target}.tmp`, target);
  } catch (error) {
    console.error(`render ${source}: ${error.message}`);
    process.exit(1);
  }
}
