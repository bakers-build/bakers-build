# Test the run-outtake presentation

Check a coding handoff's exact login URL, review resources and presentation using the shared skill runner.

**You need:** the prerequisites in [Test a skill](/advanced/development/test-skills), including the installed Promptfoo dependency.

1. Generate the maintained case:

   ```sh
   eval_dir=assets-ai/EXAMPLE-1/promptfoo
   node tests/skill-eval/run.mjs generate --fixture run-outtake-coding \
     --output "$eval_dir/outtake" --model sonnet --timeout 180
   ```

   The fixture supplies member uid:73, an absent Invite control, a direct invitation route returning 403, passed checks, pending human review and an issued login URL. All identities and URLs are synthetic. The worker reads the current `bb-run-outtake/SKILL.md` and its maintained references. It does not receive the rubric.

2. Follow the shared guide to replay the attempt twice and request a separate semantic judgment. The profile checks required headings, absence of a passed-AC list, the unchanged issued login URL exactly once, supplied MR/evidence/paths, account/role/environment, descriptive links and one final action paragraph.

   A reviewing agent also checks meaning: pending human review must not invent a failed AC or a prerequisite for entering review. The fictional feature's human review stays pending regardless of the model verdict.

3. Remove only the login URL from a copy as a negative control:

   ```sh
   python3 - "$eval_dir" <<'PY'
   import hashlib, json, pathlib, sys
   directory = pathlib.Path(sys.argv[1])
   attempt = json.loads((directory / 'outtake/attempt.json').read_text())
   login = attempt['generation']['fixture']['input']['manual_review']['login_url']
   assert attempt['output'].count(login) == 1
   attempt['negative_control'] = {
       'reason': 'Remove only the issued login URL',
       'parent_output_sha256': attempt['generation']['output_sha256'],
   }
   attempt['output'] = attempt['output'].replace(login, '')
   attempt['output_sha256'] = hashlib.sha256(attempt['output'].encode()).hexdigest()
   with (directory / 'invalid-attempt.json').open('x') as destination:
       json.dump(attempt, destination, indent=2)
   PY
   node tests/skill-eval/run.mjs replay --input "$eval_dir/invalid-attempt.json" \
     --output "$eval_dir/invalid-result.json"
   ```

**Done when:** two unchanged replays agree, the negative control fails `issued-login-url` with exit 1, and semantic findings are recorded. Other link checks may also fail after removing the URL. Preserve observed renderer defects instead of weakening assertions or modifying the skill to make the evaluation green.

The old `run-outtake.mjs` command and saved version 1 attempts remain supported. For other skill cases, use the same operations with another fixture. See [Add a skill test](/advanced/development/add-skill-test) for the profile contract and [HTTP result sharing](/advanced/development/test-skills#share-results-over-http) for tunnel links.
