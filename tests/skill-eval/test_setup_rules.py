"""The setup skills' text carries the block-question rules the setup conversation depends on."""
from pathlib import Path
import json
import re
import unittest

SKILLS = Path(__file__).resolve().parents[2] / '.claude/skills/bakers-build/skills'
CONVERSATION = SKILLS / 'bb-init/references/setup-conversation.md'
TAKE_ALL = Path(__file__).resolve().parent / 'fixtures/setup/setup-blocks-take-all.json'
OWN_DECISIONS = ['permission mode', 'grants', 'merge policy', 'forge authentication', 'server group']
HOOKS = ['after_create', 'before_run', 'after_run', 'after_done', 'on_freeze', 'on_resume']
MATRICES = [SKILLS / 'bb-init/references/machine-setup.md', SKILLS / 'bb-init-project/references/project-setup.md']


def blocks(path):
    """Each `###` block heading of a matrix with its table rows."""
    sections = re.split(r'^### ', path.read_text(), flags=re.M)[1:]
    return {section.splitlines()[0]: table_rows_of(section.splitlines()) for section in sections}


def table_rows(path):
    return table_rows_of(path.read_text().splitlines())


def table_rows_of(lines):
    """Each row of every block table as {header: cell}."""
    cells = lambda line: [cell.strip() for cell in line.strip().strip('|').split('|')]
    rows = []
    for index, line in enumerate(lines[:-1]):
        if line.startswith('|') and lines[index + 1].startswith('|---'):
            header = cells(line)
            for row in lines[index + 2:]:
                if not row.startswith('|'):
                    break
                rows.append(dict(zip(header, cells(row))))
    return rows


class SetupRulesTest(unittest.TestCase):
    def test_one_block_per_turn_replaces_one_field_per_turn(self):
        rules = CONVERSATION.read_text()
        self.assertIn('one block per turn', rules)
        self.assertNotIn('one field or decision per turn', rules)
        project = MATRICES[1].read_text()
        for retired in ['one turn each', 'in its own turn']:
            self.assertNotIn(retired, project)

    def test_own_decisions_are_named(self):
        line = next(line for line in CONVERSATION.read_text().splitlines() if '**Own decisions**' in line)
        for decision in OWN_DECISIONS:
            self.assertIn(decision, line)
        self.assertIn('one per question', line)

    def test_every_matrix_derives_and_explains(self):
        rows = [row for path in MATRICES for row in table_rows(path)]
        for path in MATRICES:
            self.assertTrue(table_rows(path), path.name)
            for row in table_rows(path):
                self.assertTrue({'Decide', 'Derive from', 'Explain'} <= set(row), f'{path.name}: {row}')
        explained = {term: [row['Explain'] for row in rows if term in row['Decide'] and row['Explain'] not in {'', '—'}]
                     for term in ['provision_exec', 'provision_up', 'Host role', 'grants', 'Tunnel transport']}
        for term, explanations in explained.items():
            self.assertTrue(explanations, f'{term} needs a one-sentence explanation')
        tunnel = ' '.join(explained['Tunnel transport'])
        self.assertIn('own Cloudflare domain', tunnel)
        self.assertIn('quick tunnel', tunnel)

    def test_every_row_names_its_write_target(self):
        for path in MATRICES:
            for row in table_rows(path):
                with self.subTest(path=path.name, row=row['Decide']):
                    self.assertNotIn(row.get('Writes', ''), {'', '—'}, 'a preview names where each value is written')

    def test_target_branch_is_written_to_the_deliver_hint_and_reuses_default_branch(self):
        rows = blocks(MATRICES[1])
        target = next(row for row in rows['Delivery'] if row['Decide'] == 'Target branch')
        self.assertIn('WORKFLOW.md', target['Writes'])
        self.assertIn('bb-phase-deliver', target['Writes'])
        self.assertIn('default_branch', target['Derive from'])
        server = rows['Server project'][0]
        self.assertIn('default_branch', server['Decide'])

    def test_question_budget_of_an_existing_project_fits_take_all(self):
        # An existing project skips the server-project block and the server group.
        block_count = len([name for name in blocks(MATRICES[1]) if name != 'Server project'])
        budget = block_count + len(OWN_DECISIONS) - 1
        self.assertLessEqual(budget, json.loads(TAKE_ALL.read_text())['max_questions'])

    def test_hook_row_names_every_lifecycle_hook(self):
        hooks = next(row for row in blocks(MATRICES[1])['Environment'] if 'Lifecycle hooks' in row['When'])
        for hook in HOOKS:
            self.assertIn(f'`{hook}`', hooks['Decide'])
            self.assertIn(f'hooks.{hook}', hooks['Writes'])

    def test_documentation_links_are_full_text_markdown(self):
        for path in sorted({*SKILLS.glob('bb-init/**/*.md'), *SKILLS.glob('bb-init-project/**/*.md')}):
            for url in re.findall(r'https://bakers\.build/[^)\s`]*', path.read_text()):
                with self.subTest(path=path.name, url=url):
                    self.assertTrue(url.split('#')[0].endswith('.md'), 'link the page source, not the rendered page')

    def test_setup_loads_few_documentation_pages(self):
        # Facts the setup needs are inlined; each linked page is one more load in a run.
        pages = {url.split('#')[0] for path in {*SKILLS.glob('bb-init/**/*.md'), *SKILLS.glob('bb-init-project/**/*.md')}
                 for url in re.findall(r'https://bakers\.build/[^)\s`]*', path.read_text()) if '<path>' not in url}
        self.assertLessEqual(len(pages), 18, sorted(pages))

    def test_onboarding_flow_is_taught(self):
        init = (SKILLS / 'bb-init/SKILL.md').read_text()
        project_skill = (SKILLS / 'bb-init-project/SKILL.md').read_text()
        machine = MATRICES[0].read_text()
        project = MATRICES[1].read_text()
        rules = CONVERSATION.read_text()
        # Welcome names the steps and the files written.
        welcome = init.split('## Welcome', 1)[1].split('\n## ', 1)[0]
        for written in ['machine.config.js', 'connections/default.js', '.bakers/project.config.js', 'WORKFLOW.md']:
            self.assertIn(written, welcome)
        self.assertIn('## Welcome', project_skill)
        # Every block question carries its step; configs are shown back masked.
        self.assertIn('Step n of m', rules)
        self.assertIn('***', rules)
        # Sign-in defaults to the hosted server.
        sign_in = blocks(MATRICES[0])['Sign-in'][0]
        self.assertIn('https://app.bakers.build', sign_in['Recommend'])
        # The worktree check runs and reports pass or fail with a reason.
        self.assertIn('git worktree add', project)
        self.assertIn('git worktree remove', project)
        self.assertIn('fail — <reason>', project)
        self.assertIn('Step n of m — Worktree', project)
        # The private credentials file is explained where the harness is registered.
        harness = next(row for row in blocks(MATRICES[0])['Machine'] if row['Decide'] == 'Agent harness to register')
        self.assertIn('.bakers.env', harness['Explain'])
        # Both sandbox runtimes are offered with their prerequisites.
        mode = next(row for row in blocks(MATRICES[0])['Permissions'] if 'Permission mode' in row['Decide'])
        for runtime, check in [('runtime-bwrap', 'bwrap'), ('runtime-docker', 'docker info')]:
            self.assertIn(runtime, mode['Recommend'])
            self.assertIn(check, mode['Derive from'])
        # The flow ends by starting the conductor and offering a first ticket.
        self.assertNotIn('do not start ticket work', project_skill)
        self.assertIn('#start-the-session', project_skill)
        session = project.split('## Start the session', 1)[1]
        self.assertIn('bakers conductor start', session)
        self.assertIn('bb-create-ticket', session)
        # The first ticket is a concrete example to accept as it is.
        self.assertIn('Title:', session)
        self.assertIn('Description:', session)
        # Setup first checks for a Git repository and, outside one, offers the northbakery sample.
        repository = project.split('## Check the repository first', 1)[1].split('\n## ', 1)[0]
        self.assertIn('git rev-parse --show-toplevel', repository)
        self.assertIn('fail — not a Git repository', repository)
        self.assertIn('Step 1 of m — Repository', repository)
        self.assertIn('git clone https://github.com/bakers-build/northbakery.git', repository)
        self.assertLess(project.index('## Check the repository first'), project.index('## Check worktree compatibility first'))
        self.assertIn('#check-the-repository-first', project_skill)

    def test_setup_cases_stay_few(self):
        cases = [path for path in TAKE_ALL.parent.glob('*.json') if path.name != 'defaults.json']
        self.assertLessEqual(len(cases), 10)


if __name__ == '__main__':
    unittest.main()
