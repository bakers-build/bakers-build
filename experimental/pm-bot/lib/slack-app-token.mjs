#!/usr/bin/env node
// The start check of the Slack app token the Hermes gateway connects with (Socket Mode).
// Exit 3 with one line naming SLACK_APP_TOKEN when Slack rejects it, else exit 0: an
// unreachable Slack or another error is the gateway's to report.
//
//   node experimental/pm-bot/lib/slack-app-token.mjs

import { realpathSync } from 'node:fs';

// Slack's answers for a token it no longer accepts.
export const SLACK_REJECTED = ['invalid_auth', 'not_authed', 'token_revoked', 'token_expired', 'account_inactive'];

/** Why Slack rejects the app token, or null when it does not. */
export async function appTokenRejected({ url = 'https://slack.com/api', token }) {
  let answer;
  try {
    const res = await fetch(`${url}/apps.connections.open`, { method: 'POST', headers: { authorization: `Bearer ${token}` } });
    answer = await res.json();
  } catch {
    return null;
  }
  return SLACK_REJECTED.includes(answer?.error) ? `Slack rejected SLACK_APP_TOKEN (${answer.error})` : null;
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(new URL(import.meta.url).pathname)) {
  const rejected = await appTokenRejected({ url: process.env.SLACK_API_URL || undefined, token: process.env.SLACK_APP_TOKEN });
  if (rejected) {
    console.error(`pm-bot: ${rejected}; reinstall the Slack app and update pm_bot_slack_app_token`);
    process.exit(3);
  }
}
