#!/usr/bin/env python3
"""Compatibility batch launcher; evaluation belongs to the shared Node runner."""
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import subprocess

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--list', action='store_true')
    parser.add_argument('--fixture', action='append')
    parser.add_argument('--model', default='sonnet')
    parser.add_argument('--timeout', type=int, default=180)
    parser.add_argument('--prepare-only', action='store_true')
    args = parser.parse_args()
    cli = ['node', str(HERE / 'run.mjs')]
    if args.list:
        return subprocess.call([*cli, 'list'])
    known = subprocess.check_output([*cli, 'list'], text=True).splitlines()
    fixtures = args.fixture or [f.get('id', f.get('fixture')) for f in json.loads((HERE / 'fixtures.json').read_text())]
    if set(fixtures) - set(known):
        parser.error('Unknown fixture; use --list')
    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    output = ROOT / 'assets-ai/skill-eval' / stamp
    output.mkdir(parents=True)
    print(f'Artifacts: {output}', flush=True)
    codes = []
    rows = []
    for fixture in dict.fromkeys(fixtures):
        directory = output / fixture
        operation = 'prepare' if args.prepare_only else 'generate'
        code = subprocess.call([*cli, operation, '--fixture', fixture, '--output', str(directory),
                                '--model', args.model, '--timeout', str(args.timeout)])
        codes.append(code)
        if not args.prepare_only and code in (0, 1):
            codes.append(subprocess.call([*cli, 'judge', '--input', str(directory / 'attempt.json'),
                                         '--output', str(directory / 'semantic'), '--model', args.model,
                                         '--timeout', str(args.timeout)]))
        rows.append({'fixture': fixture, 'result': str(directory / 'result.json')})
    (output / 'report.json').write_text(json.dumps({'command': 'run.py', 'results': rows}, indent=2) + '\n')
    return 2 if any(c not in (0, 1) for c in codes) else int(1 in codes)


if __name__ == '__main__':
    raise SystemExit(main())
