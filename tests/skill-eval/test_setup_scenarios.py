"""The setup workflows the skills teach, as `bakers tools` call sequences against the simulator.

Each scenario replays the calls its skill or reference documents and checks the outcome; its
retired generic-CRUD form must fail, so a worker that still emits it fails the case.
"""
import json
import unittest

from test_tool_calls import TOOL, load_server

WORKSPACE = '66666666-6666-4666-8666-666666666666'
PROJECT = '55555555-5555-4555-8555-555555555555'
PARENT = '11111111-1111-4111-8111-111111111111'


class Scenario(unittest.TestCase):
    simulation = {}

    def setUp(self):
        self.sim = load_server().Simulation({'input': {'workspace_uuid': WORKSPACE, 'project_uuid': PROJECT},
                                             'simulation': json.loads(json.dumps(self.simulation))})

    def tool(self, name, args, code=0):
        response = self.sim.call('bakers', {'argv': TOOL + [f'tool_api__bakers_{name}', '--data', json.dumps(args)]})
        self.assertEqual(response['exit_code'], code, response['stderr'])
        return json.loads(response['stdout'] if code == 0 else response['stderr'])

    def assertRetired(self, *argv):
        response = self.sim.call('bakers', {'argv': ['bakers', 'dropsh', *argv]})
        self.assertEqual(response['exit_code'], 2)
        self.assertIn('not part of the skill contract', response['stderr'])


class ProjectSetupScenario(Scenario):
    """bb-create-project: look up workspace, groups and teams; create group and project; read back."""
    simulation = {'teams': [{'uuid': '77777777-7777-4777-8777-000000000001', 'name': 'North'}],
                  'groups': [{'uuid': '44444444-4444-4444-8444-000000000009', 'name': 'Existing', 'description': None}]}

    def test_group_and_project_are_created_and_read_back(self):
        workspace = self.tool('workspace_list', {})['workspaces'][0]['uuid']
        self.assertEqual(workspace, WORKSPACE)
        self.assertEqual([g['name'] for g in self.tool('group_list', {'workspace': workspace})['groups']], ['Existing'])
        teams = [t['uuid'] for t in self.tool('team_list', {'workspace': workspace})['teams']]
        group = self.tool('group_create', {'workspace': workspace, 'name': 'Bakery', 'description': 'Bread and rolls.'})
        project = self.tool('project_create', {'group': group['uuid'], 'name': 'Oven', 'teams': teams, 'description': 'Oven control.'})
        read = self.tool('project_read', {'project': project['key']})
        self.assertEqual((read['uuid'], read['group'], read['teams'], read['description']),
                         (project['uuid'], group['uuid'], teams, 'Oven control.'))
        self.assertEqual(self.tool('group_list', {'workspace': workspace, 'group': group['uuid']})['groups'][0]['description'], 'Bread and rolls.')

    def test_a_project_without_teams_and_the_generic_create_are_refused(self):
        self.tool('project_create', {'group': '44444444-4444-4444-8444-000000000009', 'name': 'Oven', 'teams': []}, code=1)
        self.assertRetired('create', 'bb_project', '--data', '{"name": "Oven"}')


class AgentLabelScenario(Scenario):
    """agent-choice: a confirmed agent label is added, keeping unrelated labels."""
    simulation = {'ticket': {'id': PARENT, 'identifier': 'EVAL-20', 'title': 'T', 'workflow': 'bb_work', 'state': 'qualification',
                             'labels': ['customer']}}

    def test_label_is_added_once_and_existing_labels_stay(self):
        for _ in range(2):
            saved = self.tool('ticket_update', {'ticket': 'EVAL-20', 'labels_add': ['agent:claude']})
        self.assertEqual(saved['labels'], ['customer', 'agent:claude'])
        self.assertEqual(self.tool('ticket_read', {'ticket': 'EVAL-20'})['labels'], ['customer', 'agent:claude'])

    def test_the_generic_label_update_is_retired(self):
        self.assertRetired('update', 'bb_ticket/bb_ticket/' + PARENT, '--label_names', 'agent:claude')


class BranchParentScenario(Scenario):
    """bb-create-ticket: the checkout's branch finds the parent; a chosen conductor is set after creation."""
    simulation = {'ticket': {'id': PARENT, 'identifier': 'EVAL-20', 'title': 'Parent', 'workflow': 'bb_work', 'state': 'working',
                             'branch_name': 'feat/eval-20-parent'},
                  'conductors': [{'uuid': '88888888-8888-4888-8888-000000000001', 'conductor_id': 'oven-1', 'label': 'Oven 1',
                                  'active': True, 'status': 'idle'}]}

    def test_child_is_created_under_the_branch_ticket_and_assigned(self):
        matches = self.tool('ticket_search', {'branch_name': 'feat/eval-20-parent', 'project': PROJECT})['tickets']
        self.assertEqual([m['identifier'] for m in matches], ['EVAL-20'])
        created = self.tool('ticket_create', {'title': 'Child', 'workflow': 'bb_work', 'project': PROJECT, 'parent': matches[0]['identifier']})
        conductor = self.tool('conductor_list', {'project': PROJECT})['conductors'][0]['uuid']
        self.assertEqual(self.tool('ticket_update', {'ticket': created['id'], 'conductor': conductor})['conductor'], conductor)
        child = self.tool('ticket_search', {'branch_name': created['branch_name']})['tickets']
        self.assertEqual([(c['identifier'], c['parent']) for c in child], [(created['identifier'], 'EVAL-20')])

    def test_an_unknown_branch_finds_no_parent_and_the_generic_search_is_retired(self):
        self.assertEqual(self.tool('ticket_search', {'branch_name': 'feat/none', 'project': PROJECT})['tickets'], [])
        self.assertRetired('search', 'bb_ticket', '--filter', 'branch_name=feat/eval-20-parent')


class TemplateRunScenario(Scenario):
    """tools-lookup: run a ticket template with overrides; a workspace template needs a project."""
    simulation = {'templates': [
        {'uuid': '99999999-9999-4999-8999-000000000001', 'title': 'Monthly report {{month}}', 'workflow': 'bb_work', 'project': PROJECT},
        {'uuid': '99999999-9999-4999-8999-000000000002', 'title': 'Workspace chore', 'workflow': 'bb_work', 'project': None},
    ]}

    def test_template_creates_a_ticket_with_the_given_overrides(self):
        created = self.tool('ticket_template_run', {'template': '99999999-9999-4999-8999-000000000001', 'title': 'Report November'})
        read = self.tool('ticket_read', {'ticket': created['identifier']})
        self.assertEqual((read['id'], read['title'], read['workflow']), (created['uuid'], 'Report November', 'bb_work'))

    def test_workspace_template_needs_a_project_and_unknown_templates_are_refused(self):
        workspace_template = '99999999-9999-4999-8999-000000000002'
        self.assertIn('project is required',self.tool('ticket_template_run', {'template': workspace_template}, code=1)['error']['message'])
        created = self.tool('ticket_template_run', {'template': workspace_template, 'project': PROJECT})
        self.assertEqual(self.tool('ticket_read', {'ticket': created['uuid']})['title'], 'Workspace chore')
        self.tool('ticket_template_run', {'template': '99999999-9999-4999-8999-000000000404'}, code=1)
        self.assertRetired('tool', 'bakers_ticket_template_run', '--data', '{}')


if __name__ == '__main__':
    unittest.main()
