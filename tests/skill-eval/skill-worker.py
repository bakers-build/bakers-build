#!/usr/bin/env python3
"""Generation and explicit semantic judging for the shared skill evaluation.

Reuse the existing runner's isolation, stream validation and maintained-source snapshots.
This bridge is never loaded or executed by deterministic replay.
"""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import sys

import worker as run


def digest(text):
    return hashlib.sha256(text.encode()).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('operation', choices=['generate', 'prepare', 'judge'])
    parser.add_argument('--input', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--model', default='sonnet')
    parser.add_argument('--timeout', type=int, default=180)
    args = parser.parse_args()
    directory = Path(args.output)
    record = {'command': sys.argv, 'status': 'error', 'requested_model': args.model}
    target = directory / ('generation.json' if args.operation in {'generate', 'prepare'} else 'semantic.json')
    try:
        raw = Path(args.input).read_text()
        data = json.loads(raw)
        record['revision'] = subprocess.check_output(
            ['git', 'rev-parse', 'HEAD'], cwd=run.ROOT, text=True).strip()
        record['dirty'] = bool(subprocess.check_output(
            ['git', 'status', '--porcelain'], cwd=run.ROOT, text=True).strip())
        record['runner_sha256'] = digest(Path(run.__file__).read_text())
        record['bridge_sha256'] = digest(Path(__file__).read_text())
        record['python_version'] = sys.version.split()[0]
        if args.operation in {'generate', 'prepare'}:
            fixture = data
            sources = run.snapshot(fixture, directory)
            prompt = run.encode({'skill': fixture['skill'], 'sources': sources, 'ticket': fixture['input']})
            record.update(fixture=fixture, fixture_source=raw, fixture_sha256=digest(raw),
                          sources=sources, prompt=prompt, prompt_sha256=digest(prompt))
            if fixture.get('execution') == 'simulated-tools':
                record['simulator_sha256'] = digest((run.HERE / 'tool-server.py').read_text())
                record['simulator_contract_sha256'] = digest((run.HERE / 'contract-fixture.json').read_text())
            target.write_text(run.encode(record))
            if args.operation == 'prepare':
                record['status'] = 'prepared'
                target.write_text(run.encode(record))
                return 0
            tool_mode = fixture.get('execution') == 'simulated-tools'
            artifact, metadata = run.invoke(prompt, run.TOOL_WORKER if tool_mode else run.WORKER, directory / 'worker', args.model, args.timeout, fixture=fixture if tool_mode else None)
            if tool_mode:
                trace = metadata.pop('tool_trace')
                trace_source = json.dumps(trace, ensure_ascii=False, separators=(',', ':'))
                record.update(tool_trace=trace, tool_trace_source=trace_source, tool_trace_sha256=digest(trace_source), simulator_sha256=digest((directory / 'worker/tool-server.py').read_text()))
            record.update(status='generated', output=artifact, output_sha256=digest(artifact), worker=metadata)
        else:
            fixture = data['generation']['fixture']
            prompt = run.encode({'ticket': fixture['input'], 'criteria': fixture['rubric'],
                                 'candidate_artifact': data['output'], 'tool_trace': data.get('tool_trace')})
            raw_grade, metadata = run.invoke(prompt, run.JUDGE, directory / 'judge', args.model, args.timeout)
            checks = run.parse_grade(raw_grade, fixture['rubric'], data['output'])
            record.update(status='passed' if all(c['met'] for c in checks) else 'failed',
                          checks=checks, judge=metadata, attempt_sha256=digest(raw))
    except (OSError, ValueError, TypeError, KeyError, subprocess.SubprocessError) as exc:
        record['error'] = str(exc)
    target.write_text(run.encode(record))
    print(record['status'])
    return 2 if record['status'] == 'error' else int(record['status'] == 'failed')


if __name__ == '__main__':
    raise SystemExit(main())
