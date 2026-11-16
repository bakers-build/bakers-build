"""The setup skills' text carries the block-question rules the setup conversation depends on."""
from pathlib import Path
import re
import unittest

SKILLS = Path(__file__).resolve().parents[2] / '.claude/skills/bakers-build/skills'
CONVERSATION = SKILLS / 'bb-init/references/setup-conversation.md'
MATRICES = [SKILLS / 'bb-init/references/machine-setup.md', SKILLS / 'bb-init-project/references/project-setup.md']


def table_rows(path):
    """Each row of every block table as {header: cell}."""
    cells = lambda line: [cell.strip() for cell in line.strip().strip('|').split('|')]
    lines = path.read_text().splitlines()
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
        for decision in ['permission mode', 'grants', 'merge policy', 'forge authentication', 'server group']:
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

    def test_documentation_links_are_full_text_markdown(self):
        for path in sorted({*SKILLS.glob('bb-init/**/*.md'), *SKILLS.glob('bb-init-project/**/*.md')}):
            for url in re.findall(r'https://bakers\.build/[^)\s`]*', path.read_text()):
                with self.subTest(path=path.name, url=url):
                    self.assertTrue(url.split('#')[0].endswith('.md'), 'link the page source, not the rendered page')


if __name__ == '__main__':
    unittest.main()
