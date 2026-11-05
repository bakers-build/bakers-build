// The poller wired to the site and Slack stubs, with a recording `hermes send`.

import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBakersClient } from '../lib/bakers-client.mjs';
import { createPoller, createSlack } from '../poller/poller.mjs';
import { PROJECT, site } from './site.mjs';
import { slackStub } from './stubs.mjs';

const messages = JSON.parse(readFileSync(new URL('../poller/messages.json', import.meta.url), 'utf8'));
const quiet = { log: () => {}, error: () => {} };

export async function setup(t, siteOptions = {}) {
  const s = await site(siteOptions);
  const slack = await slackStub();
  t.after(s.close);
  t.after(slack.close);
  const sent = [];
  let sendFails = false;
  const stateFile = join(mkdtempSync(join(tmpdir(), 'pm-poller-')), 'poller-state.json');
  // A fresh poller on the same state file, as after a restart.
  const start = () => createPoller({
    client: createBakersClient({ url: s.stub.url, apiKey: 'bb-test-key' }),
    slack: createSlack({ url: slack.url, token: 'xoxb-test' }),
    send: async (message) => {
      if (sendFails) throw new Error('hermes send exited 1');
      sent.push(message);
    },
    stateFile,
    project: PROJECT,
    messages,
    log: quiet,
  });
  const poller = start();
  const state = () => JSON.parse(readFileSync(stateFile, 'utf8'));
  return { s, slack, sent, poller, state, restart: start, failSend: (value) => (sendFails = value) };
}

