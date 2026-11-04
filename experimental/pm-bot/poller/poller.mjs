#!/usr/bin/env node
// The PM bot's poller. Every interval it reads the project's tickets from
// bakers.build through its tools and, for each ticket whose first `chat` link is a Slack thread:
// posts each state change into that thread once, relays its open question once,
// and opens a thread of its own for each sub-ticket. No LLM, no dependencies.
//
//   node experimental/pm-bot/poller/poller.mjs          # loop
//   node experimental/pm-bot/poller/poller.mjs --once   # one pass, then exit
//
// Configuration comes from the environment (experimental/pm-bot/.env, see .env.example).
// While bakers.build is unreachable a pass fails, is logged and keeps the state
// file as it was; the next pass catches up, so nothing is lost or posted twice.

import { spawn } from 'node:child_process';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createBakersClient } from '../lib/bakers-client.mjs';
import { diff, reachedDone } from './diff.mjs';
import { pollInterval } from './interval.mjs';
import { escape, openQuestion, relay } from './questions.mjs';
import { chatThread, pendingSubTickets } from './tickets.mjs';

const fill = (template, values) => template.replace(/\{(\w+)\}/g, (_, key) => values[key]);

/** The Slack Web API calls the poller makes. */
export function createSlack({ url = 'https://slack.com/api', token }) {
  async function call(method, body) {
    const res = await fetch(`${url}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8', authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    const answer = await res.json();
    if (!answer.ok) throw new Error(`${method} failed: ${answer.error}`);
    return answer;
  }
  return {
    // A message, in a thread when thread_ts is given; returns its ts.
    post: async ({ channel, thread_ts, text }) => (await call('chat.postMessage', { channel, thread_ts, text })).ts,
    permalink: async (channel, ts) => (await call('chat.getPermalink', { channel, message_ts: ts })).permalink,
  };
}

// A relayed question goes through Hermes, which also adds it to the thread's
// session: the agent knows the question when someone in the thread answers.
export function hermesSend({ channel, thread_ts, text }) {
  return new Promise((resolve, reject) => {
    const child = spawn('hermes', ['send', '--to', `slack:${channel}:${thread_ts}`, '--quiet', '--file', '-'], { stdio: ['pipe', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`hermes send exited ${code}: ${stderr.trim()}`))));
    child.stdin.end(text);
  });
}

/**
 * @param {{client: ReturnType<typeof createBakersClient>, slack: ReturnType<typeof createSlack>,
 *   send: (message: {question: string, identifier: string, channel: string, thread_ts: string, text: string}) => Promise<void>,
 *   stateFile: string, project: string, messages: any, log?: {log: Function, error: Function}}} options
 */
export function createPoller({ client, slack, send, stateFile, project, messages, log = console }) {
  const stamp = () => new Date().toISOString();

  // Every ticket of the project, page by page, through the bakers list tool.
  async function tickets() {
    const out = [];
    let offset = 0;
    while (offset !== null && offset !== undefined) {
      const page = await client.tool('bakers_ticket_list', { project, limit: 50, offset });
      for (const t of page.tickets) {
        out.push({
          id: t.id,
          identifier: t.identifier,
          title: t.title,
          state: t.state,
          thread: chatThread(t.links),
          labels: t.labels ?? [],
          frozen: Boolean(t.frozen),
          frozen_at: t.frozen_at ?? null,
          parent: t.parent ?? null,
          closed: Boolean(t.closed),
        });
      }
      offset = page.next_offset;
    }
    return out;
  }

  // A ticket's comments, newest first, optionally of one type, from bakers_ticket_read.
  async function comments(ticketId, type) {
    const ticket = await client.tool('bakers_ticket_read', { ticket: ticketId });
    return (ticket.comments ?? [])
      .filter((c) => !type || c.type === type)
      .map((c) => ({ id: c.id, type: c.type, created: c.created, body: c.body ?? '' }))
      .sort((a, b) => Date.parse(b.created) - Date.parse(a.created));
  }

  // The state file: {tickets: identifier → state, relayed: comment UUIDs,
  // threads: identifier → the sub-ticket thread opened for it}.
  async function readState() {
    try {
      const state = JSON.parse(await readFile(stateFile, 'utf8'));
      return { tickets: state.tickets ?? null, relayed: state.relayed ?? [], threads: state.threads ?? {} };
    } catch (error) {
      if (error.code === 'ENOENT') return { tickets: null, relayed: [], threads: {} };
      throw error;
    }
  }

  async function writeState(state) {
    await writeFile(`${stateFile}.tmp`, JSON.stringify(state, null, 2));
    await rename(`${stateFile}.tmp`, stateFile);
  }

  async function postStates(state, current) {
    const summaries = {};
    for (const identifier of reachedDone(state.tickets, current)) {
      const [summary] = await comments(current.find((t) => t.identifier === identifier).id, 'summary');
      summaries[identifier] = summary?.body ?? '';
    }
    const { posts, next } = diff(state.tickets, current, summaries, messages);
    for (const p of posts) {
      try {
        await slack.post(p);
        log.log(`${stamp()} posted ${p.identifier}: ${next[p.identifier]}`);
      } catch (error) {
        // Keep the old state of this ticket only, so the next pass retries just this post.
        next[p.identifier] = state.tickets[p.identifier];
        log.error(`${stamp()} ${p.identifier}: ${error.message}`);
      }
    }
    state.tickets = next;
  }

  async function relayQuestions(state, current) {
    const open = [];
    let complete = true;
    for (const ticket of current.filter((t) => t.thread && t.frozen && t.labels.includes('Question'))) {
      try {
        const question = openQuestion(ticket, await comments(ticket.id));
        if (question) open.push({ ticket, question });
      } catch (error) {
        complete = false;
        log.error(`${stamp()} question of ${ticket.identifier}: ${error.message}`);
      }
    }
    const selected = relay(state.relayed, open, complete, messages.questionLead);
    state.relayed = selected.relayed;
    for (const q of selected.posts) {
      try {
        await send(q);
        state.relayed.push(q.question);
        log.log(`${stamp()} relayed question ${q.question} of ${q.identifier}`);
      } catch (error) {
        // Not recorded, so the next pass retries it.
        log.error(`${stamp()} question ${q.question} of ${q.identifier}: ${error.message}`);
      }
    }
  }

  // Each step is recorded before the next, so a failure resumes at the step
  // not yet done and never opens a second thread.
  async function subTicketThreads(state, current) {
    const byId = new Map(current.map((t) => [t.id, t]));
    for (;;) {
      const pending = pendingSubTickets(current);
      const pendingIds = new Set(pending.map((p) => p.ticket.id));
      // Parents first: a sub-ticket waits while its own parent is getting a thread.
      const ready = pending.filter((p) => !pendingIds.has(p.parent.id) && !state.threads[p.ticket.identifier]?.failed);
      if (!ready.length) break;
      for (const { ticket, parent, ancestor } of ready) {
        try {
          let record = state.threads[ticket.identifier];
          if (!record) {
            const text = fill(messages.subTicketThread, { identifier: ticket.identifier, title: escape(ticket.title), parent: parent.identifier });
            const ts = await slack.post({ channel: ancestor.thread.channel, text });
            record = { channel: ancestor.thread.channel, ts, linked: false, pointed: false, parentChannel: ancestor.thread.channel, parentTs: ancestor.thread.thread_ts };
            state.threads[ticket.identifier] = record;
            await writeState(state);
          }
          record.permalink ??= await slack.permalink(record.channel, record.ts);
          await writeState(state);
          await client.tool('bakers_ticket_transition', { ticket: ticket.id, links: [{ uri: record.permalink, title: 'Slack thread' }] });
          record.linked = true;
          await writeState(state);
          byId.get(ticket.id).thread = chatThread([{ uri: record.permalink, options: { bakers: { kind: 'chat' } } }]);
        } catch (error) {
          // Tried again on the next pass; this pass moves on.
          state.threads[ticket.identifier] && (state.threads[ticket.identifier].failed = true);
          log.error(`${stamp()} sub-ticket thread of ${ticket.identifier}: ${error.message}`);
        }
      }
    }
    for (const [identifier, record] of Object.entries(state.threads)) {
      delete record.failed;
      if (!record.linked || record.pointed) continue;
      const ticket = current.find((t) => t.identifier === identifier);
      try {
        const text = fill(messages.subTicketPointer, { identifier, title: escape(ticket?.title ?? identifier), permalink: record.permalink });
        await slack.post({ channel: record.parentChannel, thread_ts: record.parentTs, text });
        record.pointed = true;
        await writeState(state);
      } catch (error) {
        log.error(`${stamp()} pointer to ${identifier}: ${error.message}`);
      }
    }
  }

  async function pass() {
    try {
      const state = await readState();
      const current = await tickets();
      await subTicketThreads(state, current);
      await postStates(state, current);
      // Questions are relayed on the first pass too: they wait for an answer.
      await relayQuestions(state, current);
      await writeState(state);
    } catch (error) {
      // bakers.build unreachable: the state file stays as it was, the next pass catches up.
      log.error(`${stamp()} pass failed: ${error.message}`);
    }
  }

  return { pass };
}

const isMain = process.argv[1] && (await import('node:fs')).realpathSync(process.argv[1]) === (await import('node:fs')).realpathSync(new URL(import.meta.url).pathname);

if (isMain) {
  const env = (name) => {
    const value = process.env[name];
    if (!value) throw new Error(`${name} is not set`);
    return value;
  };
  const poller = createPoller({
    client: createBakersClient({ url: env('BAKERS_URL'), apiKey: env('BAKERS_API_KEY') }),
    slack: createSlack({ url: process.env.SLACK_API_URL || undefined, token: env('SLACK_BOT_TOKEN') }),
    send: hermesSend,
    stateFile: join(env('HERMES_HOME'), 'poller-state.json'),
    project: env('PM_BOT_PROJECT'),
    messages: JSON.parse(await readFile(new URL('./messages.json', import.meta.url), 'utf8')),
  });
  if (process.argv.includes('--once')) {
    await poller.pass();
  } else {
    const interval = pollInterval(process.env.PM_BOT_POLL_INTERVAL);
    for (;;) {
      await poller.pass();
      await new Promise((resolve) => setTimeout(resolve, interval));
    }
  }
}
