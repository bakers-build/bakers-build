#!/usr/bin/env node
// pm-relay: the PM bot's local MCP server over stdio and its only writer to
// bakers.build. Hermes starts it; it makes no LLM call. Each tool is a fixed,
// multi-step operation, signed in with the service account's API key through
// ../lib/bakers-client.mjs. The bot's image holds it at /opt/pm-bot/relay/; it
// reads its values from the env file its argument names ($HERMES_HOME/.env), so
// no secret is in config.yaml.

import { readFileSync, realpathSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { createBakersClient } from '../lib/bakers-client.mjs';

const QUESTION_LABEL = 'Question';

const string = (description) => ({ type: 'string', description });
const TOOLS = [
  {
    name: 'create_ticket',
    description:
      'Creates a ticket for a Slack request in the bot\'s project and workflow, sets the configured conductor, adds the labels (creating missing ones) and links the Slack thread. ' +
      'Returns the identifier and the outcome of each step; report a failed step honestly.',
    inputSchema: {
      type: 'object',
      properties: {
        title: string('A short title in the requester\'s terms, at most 200 characters.'),
        description: string('The Markdown description: Request (quoted), Current behaviour, Wanted.'),
        requester: string('The Slack display name of the person who asked.'),
        labels: { type: 'array', items: { type: 'string' }, description: 'Label names the requester asked for; may be empty.' },
        channel: string('The Slack channel ID of the thread.'),
        thread_ts: string("The timestamp of the thread's first message."),
        permalink: string('The thread permalink: <workspace URL>/archives/<channel>/p<thread_ts without the dot>.'),
      },
      required: ['title', 'description', 'requester', 'labels', 'channel', 'thread_ts', 'permalink'],
      additionalProperties: false,
    },
  },
  {
    name: 'answer_question',
    description:
      'Passes a thread answer to the ticket\'s open question: posts it as a comment crediting the answerer, removes the "Question" label and unfreezes the ticket. ' +
      'Refused when the ticket is not frozen or has no "Question" label: then the question is settled.',
    inputSchema: {
      type: 'object',
      properties: {
        ticket: string('The ticket identifier, e.g. ACME-12.'),
        text: string('The answer, complete and in the answerer\'s words.'),
        answerer: string('The Slack display name of the person who answered.'),
        channel: string('The Slack channel ID of the thread.'),
      },
      required: ['ticket', 'text', 'answerer', 'channel'],
      additionalProperties: false,
    },
  },
  {
    name: 'ticket_read',
    description: 'Reads one ticket of bakers.build with its state, links and comments.',
    inputSchema: { type: 'object', properties: { ticket: string('The ticket identifier or UUID.') }, required: ['ticket'], additionalProperties: false },
  },
  {
    name: 'ticket_search',
    description: "Searches the project's tickets whose title or description contains the query.",
    inputSchema: { type: 'object', properties: { query: string('The text to search for.') }, required: ['query'], additionalProperties: false },
  },
];

const ok = (data) => ({ content: [{ type: 'text', text: JSON.stringify(data) }], isError: false });
const refuse = (text) => ({ content: [{ type: 'text', text }], isError: true });
const text = (value, max) => typeof value === 'string' && value.trim() !== '' && value.length <= max;

/**
 * @param {{client: ReturnType<typeof createBakersClient>, env: Record<string, string | undefined>}} options
 */
export function createRelay({ client, env }) {
  const allowed = String(env.SLACK_ALLOWED_CHANNELS ?? '').split(',').map((c) => c.trim()).filter(Boolean);
  const project = env.PM_BOT_PROJECT;

  // The reason the arguments are refused, or '' when they are valid.
  function invalid(tool, a) {
    const extra = Object.keys(a).filter((key) => !(key in tool.inputSchema.properties));
    if (extra.length) return `unknown arguments: ${extra.join(', ')}`;
    if ('channel' in tool.inputSchema.properties && !allowed.includes(a.channel)) return "channel must be one of the project's Slack channels";
    if (tool.name === 'create_ticket') {
      if (!text(a.title, 200)) return 'title must be a title of at most 200 characters';
      if (!text(a.description, 20000)) return 'description must be a Markdown description';
      if (!text(a.requester, 200)) return "requester must be the requester's display name";
      if (!Array.isArray(a.labels) || a.labels.length > 10 || !a.labels.every((l) => text(l, 64))) return 'labels must be at most 10 label names';
      if (!/^[0-9]{10}\.[0-9]{6}$/.test(a.thread_ts ?? '')) return "thread_ts must be the thread's Slack timestamp";
      const expected = `/archives/${a.channel}/p${a.thread_ts.replace('.', '')}`;
      if (!/^https:\/\/[a-z0-9-]+\.slack\.com\//.test(a.permalink ?? '') || !String(a.permalink).split('?')[0].endsWith(expected)) {
        return "permalink must be this thread's Slack permalink";
      }
    }
    if (tool.name === 'answer_question') {
      if (!/^[A-Za-z][A-Za-z0-9]*-[0-9]+$/.test(a.ticket ?? '')) return 'ticket must be a ticket identifier such as ACME-12';
      if (!text(a.text, 20000)) return 'text must be the answer';
      if (!text(a.answerer, 200)) return "answerer must be the answerer's display name";
    }
    if (tool.name === 'ticket_read' && !text(a.ticket, 64)) return 'ticket must be a ticket identifier or UUID';
    if (tool.name === 'ticket_search' && !text(a.query, 200)) return 'query must be a search text';
    return '';
  }

  // The outcome of one step after creation: it never undoes the ticket.
  const step = async (fn) => {
    try {
      await fn();
      return 'ok';
    } catch (error) {
      return `failed: ${error.message}`;
    }
  };

  async function labelIds(names) {
    const projectDoc = await client.get(`/jsonapi/bb_project/bb_project/${project}?fields[bb_project--bb_project]=workspace_id`);
    const workspace = projectDoc.data.relationships.workspace_id.data.id;
    const ids = [];
    for (const name of names) {
      const query = new URLSearchParams({ 'filter[name]': name, 'filter[workspace_id.id]': workspace, 'fields[bb_term--label]': 'name' });
      const found = (await client.get(`/jsonapi/bb_term/label?${query}`)).data.find((term) => term.attributes.name === name);
      if (found) {
        ids.push(found.id);
        continue;
      }
      const created = await client.post('/jsonapi/bb_term/label', {
        data: { type: 'bb_term--label', attributes: { name }, relationships: { workspace_id: { data: { type: 'bb_workspace--bb_workspace', id: workspace } } } },
      });
      ids.push(created.data.id);
    }
    return ids;
  }

  async function createTicket(a) {
    let created;
    try {
      created = await client.tool('bakers_ticket_create', {
        title: a.title,
        workflow: env.PM_BOT_TICKET_WORKFLOW,
        project,
        description: `${a.description}\n\nRequested in Slack by ${a.requester}.`,
      });
    } catch (error) {
      return refuse(`The ticket was not created: ${error.message}`);
    }
    // By UUID from here on: identifier reads are not reliable on every site.
    const ticket = created.id;
    const steps = { create: 'ok' };
    steps.conductor = env.PM_BOT_CONDUCTOR
      ? await step(() => client.tool('bakers_ticket_update', { ticket, conductor: env.PM_BOT_CONDUCTOR }))
      : 'not set: PM_BOT_CONDUCTOR is empty';
    steps.labels = a.labels.length
      ? await step(async () => {
          const ids = await labelIds(a.labels);
          await client.patch(`/jsonapi/bb_ticket/bb_ticket/${ticket}`, {
            data: { type: 'bb_ticket--bb_ticket', id: ticket, relationships: { labels: { data: ids.map((id) => ({ type: 'bb_term--label', id })) } } },
          });
        })
      : 'none requested';
    steps.link = await step(() => client.tool('bakers_ticket_transition', { ticket, links: [{ uri: a.permalink, title: 'Slack thread' }] }));
    return ok({ identifier: created.identifier, id: ticket, steps });
  }

  async function answerQuestion(a) {
    const query = new URLSearchParams({
      'filter[identifier]': a.ticket,
      include: 'labels',
      'fields[bb_ticket--bb_ticket]': 'identifier,frozen,labels',
      'fields[bb_term--label]': 'name',
    });
    const page = await client.get(`/jsonapi/bb_ticket/bb_ticket?${query}`);
    const row = page.data.find((t) => t.attributes.identifier === a.ticket);
    if (!row) return refuse(`Ticket ${a.ticket} was not found in this project.`);
    const names = new Map((page.included ?? []).map((term) => [term.id, term.attributes.name]));
    const labels = row.relationships.labels.data;
    const question = labels.filter((l) => names.get(l.id) === QUESTION_LABEL);
    if (!row.attributes.frozen || !question.length) {
      return refuse(`${a.ticket} is not waiting for an answer: its question is settled. Tell the thread so in one line.`);
    }
    await client.tool('bakers_comment_publish', { ticket: row.id, type: 'comment', body: `Answered in Slack by ${a.answerer}:\n\n${a.text}` });
    await client.patch(`/jsonapi/bb_ticket/bb_ticket/${row.id}`, {
      data: {
        type: 'bb_ticket--bb_ticket',
        id: row.id,
        attributes: { frozen: false },
        relationships: { labels: { data: labels.filter((l) => names.get(l.id) !== QUESTION_LABEL) } },
      },
    });
    return ok({ ticket: a.ticket, answered: true });
  }

  async function call(name, args) {
    const tool = TOOLS.find((t) => t.name === name);
    const reason = invalid(tool, args);
    if (reason) return refuse(reason);
    try {
      switch (name) {
        case 'create_ticket':
          return await createTicket(args);
        case 'answer_question':
          return await answerQuestion(args);
        case 'ticket_read':
          return ok(await client.tool('bakers_ticket_read', { ticket: args.ticket }));
        case 'ticket_search':
          return ok(await client.tool('bakers_ticket_search', { query: args.query, project }));
      }
    } catch (error) {
      // bakers.build unreachable or refusing: the next call signs in again.
      return refuse(`bakers.build could not be reached or refused: ${error.message}. Tell the thread you could not do it right now.`);
    }
  }

  const reply = (id, result) => ({ jsonrpc: '2.0', id, result });
  const fail = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });

  async function handle(message) {
    const { id, method, params } = message;
    if (id === undefined) return null; // a notification
    switch (method) {
      case 'initialize':
        return reply(id, {
          protocolVersion: params?.protocolVersion ?? '2025-06-18',
          capabilities: { tools: {} },
          serverInfo: { name: 'pm-relay', version: '2' },
        });
      case 'ping':
        return reply(id, {});
      case 'tools/list':
        return reply(id, { tools: TOOLS });
      case 'tools/call':
        if (!TOOLS.some((t) => t.name === params?.name)) return fail(id, -32602, `unknown tool ${params?.name}`);
        return reply(id, await call(params.name, params.arguments ?? {}));
      default:
        return fail(id, -32601, `unknown method ${method}`);
    }
  }

  return { handle };
}

// KEY=value lines of an env file.
export function readEnv(file) {
  return Object.fromEntries(
    readFileSync(file, 'utf8')
      .split('\n')
      .map((line) => line.match(/^\s*([A-Z0-9_]+)=(.*)$/))
      .filter(Boolean)
      .map(([, key, value]) => [key, value.trim().replace(/^(['"])(.*)\1$/, '$2')]),
  );
}

// Run as a program (not imported by a test); symlinked paths such as macOS's tmpdir compare by real path.
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  // The bot's env file, named by the argument (config.yaml: $HERMES_HOME/.env). Hermes
  // starts MCP servers with a filtered environment, so the relay reads the file itself.
  if (!process.argv[2]) {
    console.error('usage: node server.mjs <env file>');
    process.exit(2);
  }
  const env = readEnv(process.argv[2]);
  const client = createBakersClient({ url: env.BAKERS_URL, clientId: env.BAKERS_CLIENT_ID, clientSecret: env.BAKERS_CLIENT_SECRET });
  const relay = createRelay({ client, env });
  const write = (message) => message && process.stdout.write(`${JSON.stringify(message)}\n`);
  createInterface({ input: process.stdin }).on('line', (line) => {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return write({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } });
    }
    relay.handle(message).then(write, (error) => write({ jsonrpc: '2.0', id: message.id ?? null, error: { code: -32603, message: error.message } }));
  });
}
