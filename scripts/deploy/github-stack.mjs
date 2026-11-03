#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';

const [mode, stack, commit] = process.argv.slice(2);
const branch = { 'bakers-develop': 'next', 'bakers-prod': 'main' }[stack];
if (!['prepare', 'verify'].includes(mode) || !branch || !/^[a-f0-9]{40}$/.test(commit ?? ''))
  throw new Error('usage: github-stack.mjs <prepare|verify> <bakers-develop|bakers-prod> <tested commit>');
for (const key of ['KOMODO_URL', 'KOMODO_API_KEY', 'KOMODO_API_SECRET'])
  if (!process.env[key]) throw new Error(`Missing ${key}`);
async function api(path, type, params) {
  const response = await fetch(`${process.env.KOMODO_URL}/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Api-Key': process.env.KOMODO_API_KEY, 'X-Api-Secret': process.env.KOMODO_API_SECRET },
    body: JSON.stringify({ type, params }), signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`${type}: HTTP ${response.status}`);
  return response.json();
}
function source(config, expectedBranch) {
  if (config.git_provider !== 'github.com' || config.repo !== 'bakers-build/bakers-build' || config.branch !== expectedBranch)
    throw new Error('Komodo repository/branch does not match the GitHub cutover configuration');
}
if (mode === 'prepare') {
  source((await api('read', 'GetResourceSync', { sync: 'bakers' })).config, 'next');
  const started = await api('execute', 'RunSync', { sync: 'bakers', resource_type: 'Stack', resources: [stack] });
  const id = started.id || started._id?.$oid;
  if (!id) throw new Error('RunSync returned no update ID');
  let complete = false;
  for (let attempt = 0; attempt < 120; attempt++) {
    const update = await api('read', 'GetUpdate', { id });
    if (update.status === 'Complete') {
      if (update.success !== true) throw new Error(`Resource Sync failed: ${id}`);
      complete = true; break;
    }
    if (!['Queued', 'InProgress'].includes(update.status)) throw new Error(`Unexpected sync status: ${update.status}`);
    await sleep(5000);
  }
  if (!complete) throw new Error('Resource Sync timed out');
  const current = await api('read', 'GetStack', { stack });
  source(current.config, branch);
  const stackId = current.id || current._id?.$oid;
  if (!stackId) throw new Error('Stack has no ID');
  // Pin the versioned Compose source; a later branch push must not change this deployment.
  await api('write', 'UpdateStack', { id: stackId, config: { commit } });
}
const current = await api('read', 'GetStack', { stack });
source(current.config, branch);
if (current.config.commit !== commit) throw new Error('Stack source is not pinned to the tested commit');
if (mode === 'verify') {
  const deployed = current.info?.deployed_hash;
  if (!deployed || deployed.length < 7 || !commit.startsWith(deployed)) throw new Error('Deployed Compose source differs from the tested commit');
  const images = new Map(readFileSync('gate-reports/registry.txt', 'utf8').trim().split('\n').map(line => {
    const [name, digest, imageId] = line.split(/\s+/);
    return [name, [digest?.split('@')[1], imageId]];
  }));
  const services = await api('read', 'ListStackServices', { stack });
  for (const name of ['php', 'nginx', 'docs']) {
    const actual = services.find(service => service.service === name)?.container?.image_id;
    if (!actual || !images.get(name)?.includes(actual)) throw new Error(`${name}: running image differs from verified registry image`);
  }
}
console.log(`${stack}: ${mode} verified for ${commit}`);
