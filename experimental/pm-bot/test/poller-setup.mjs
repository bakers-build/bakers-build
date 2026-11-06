// The poller wired to the site and Slack stubs, with a recording `hermes send`.

import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createBakersClient } from '../lib/bakers-client.mjs';
import { createPoller, createSlack } from '../poller/poller.mjs';
import { PROJECT, site } from './site.mjs';
import { slackStub } from './stubs.mjs';

const messages = JSON.parse(readFileSync(new URL('../poller/messages.json', import.meta.url), 'utf8'));
const quiet = { log: () => {}, error: () => {} };

export async function setup(t, { slackAnswers, ...siteOptions } = {}) {
  const s = await site(siteOptions);
  const slack = await slackStub(slackAnswers);
  t.after(s.close);
  t.after(slack.close);
  const sent = [];
  let sendFails = false;
  const home = mkdtempSync(join(tmpdir(), 'pm-poller-'));
  const stateFile = join(home, 'poller-state.json');
  const botChannelsFile = join(home, 'bot-channels.json');
  // The clock the poller reads; tests move it.
  const clock = { now: Date.parse('2026-11-05T12:00:00Z') };
  // A fresh poller on the same state file, as after a restart.
  const start = () => createPoller({
    client: createBakersClient({ url: s.stub.url, apiKey: 'bb-test-key' }),
    slack: createSlack({ url: slack.url, token: 'xoxb-test' }),
    send: async (message) => {
      if (sendFails) throw new Error('hermes send exited 1');
      sent.push(message);
    },
    stateFile,
    botChannelsFile,
    workspaceUrl: 'https://acme.slack.com',
    now: () => clock.now,
    project: PROJECT,
    messages,
    log: quiet,
  });
  const poller = start();
  const state = () => JSON.parse(readFileSync(stateFile, 'utf8'));
  // The request channels the bot's plugin opened, as it writes bot-channels.json.
  const botChannels = (channels) => writeFileSync(botChannelsFile, JSON.stringify(channels));
  return { s, slack, sent, poller, state, clock, botChannels, restart: start, failSend: (value) => (sendFails = value) };
}

