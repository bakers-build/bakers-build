"""The PM bot's Slack channels, as a Hermes plugin (experimental/pm-bot/README.md › How it works).

- Intake: a mention of the bot at the top of its channel (SLACK_ALLOWED_CHANNELS, one ID) opens
  a public request channel, invites the sender, acknowledges the request there, links it in a
  flat reply and hands the message on to Hermes there. The bot's channel itself holds no
  conversation.
- Reaction: a served user's message in an open channel joins Hermes' eyes lifecycle (Hermes
  runs it only for mentions); the final ✅/❌ is dropped.
- Admission: Hermes answers only in the bot's channel and in its open channels, the request
  channels this plugin opened plus the poller's reopen channels, minus the archived ones; in an
  open channel without a mention.
- Channel prompt: each open channel gets a trusted line with its ID, conversation link and
  ticket, which the model cannot see otherwise, and the bot's language; the main channel gets the
  language alone.
- Language: read once at start from the service account's background (language.py), German
  until then and on any failure; it also picks the plugin's own texts (messages.json).

This plugin writes $HERMES_HOME/bot-channels.json and bot-language.json (the bot's language for the
poller's texts); the poller writes poller-state.json. Each reads the other's files and writes only
its own.
"""

import asyncio
import json
import logging
import os
import re
from datetime import datetime, timezone

from . import language
from .channels import DEFAULT_LANGUAGE, channel_prompt, language_prompt, open_channels, read_json, request_channel_name, text

logger = logging.getLogger("pm_bot.bot_channels")

DATA = os.environ.get("HERMES_HOME") or "/opt/data"
BOT_FILE = os.path.join(DATA, "bot-channels.json")
LANGUAGE_FILE = os.path.join(DATA, "bot-language.json")
POLLER_FILE = os.path.join(DATA, "poller-state.json")


def _write(path, value):
    tmp = f"{path}.tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(value, fh, indent=2)
    os.replace(tmp, path)


def _users(raw):
    return {u for u in re.split(r"[\s,]+", raw or "") if u}


def factory(app, adapter):
    """``register_platform_handler("slack", …)``: ``app`` is Hermes' Bolt ``AsyncApp``."""
    from slack_bolt.response import BoltResponse
    from slack_sdk.errors import SlackApiError

    # First, so the poller posts German until this start's read is done, never a previous run's language.
    language.write(LANGUAGE_FILE, DEFAULT_LANGUAGE)
    home = (os.environ.get("SLACK_ALLOWED_CHANNELS") or "").strip()
    workspace = os.environ.get("SLACK_WORKSPACE_URL") or ""
    allowed_users = _users(os.environ.get("SLACK_ALLOWED_USERS"))
    if not home:
        logger.error("bot-channels: SLACK_ALLOWED_CHANNELS is empty; the plugin stays off")
        return

    lang = {"code": DEFAULT_LANGUAGE}
    language.start(lang, LANGUAGE_FILE)

    def current():
        poller = read_json(POLLER_FILE)
        return poller, open_channels(read_json(BOT_FILE), poller)

    # Instance overrides of the adapter's channel getters (shadowing the class's env/YAML
    # readers): read on every message, so a new channel is admitted at once and an archived
    # one drops out. entrypoint.sh check asserts both getters exist.
    adapter._slack_allowed_channels = lambda: {home} | current()[1]
    adapter._slack_free_response_channels = lambda: current()[1]

    # Hermes swaps eyes for ✅/❌ when it finishes; in a flat channel only eyes comes and goes.
    # CANCELLED removes eyes and adds nothing. entrypoint.sh check asserts the hook and outcome.
    complete = adapter.on_processing_complete

    async def on_processing_complete(event, outcome):
        await complete(event, type(outcome).CANCELLED)

    adapter.on_processing_complete = on_processing_complete

    def refresh_prompts():
        poller, channels = current()
        records = poller.get("channels") or {}
        prompts = adapter.config.extra.setdefault("channel_prompts", {})
        prompts[home] = language_prompt(lang["code"])
        for channel in channels:
            prompts[channel] = channel_prompt(channel, workspace, (records.get(channel) or {}).get("ticket"), lang["code"])

    def is_request(event):
        """A new mention of the bot at the top of its channel, from a served user."""
        if event.get("type") not in ("message", "app_mention") or event.get("channel") != home:
            return False
        if event.get("subtype") or event.get("bot_id") or not event.get("user"):
            return False
        if event.get("thread_ts") and event.get("thread_ts") != event.get("ts"):
            return False  # a reply in a thread from before channels: Hermes answers it there
        if allowed_users and event["user"] not in allowed_users:
            return False
        bot_user = getattr(adapter, "_bot_user_id", None)
        return event["type"] == "app_mention" or bool(bot_user and f"<@{bot_user}" in (event.get("text") or ""))

    def is_open_channel_message(event):
        """A served user's own message in one of the bot's open channels."""
        if event.get("type") != "message" or event.get("subtype") or event.get("bot_id") or not event.get("user"):
            return False
        if allowed_users and event["user"] not in allowed_users:
            return False
        return event.get("channel") in current()[1]

    lock = asyncio.Lock()
    seen = set()  # a mention arrives as message and as app_mention, with one ts
    tasks = set()

    async def open_request_channel(client, event):
        async with lock:
            # Strict: written back below, so an unreadable file fails the intake instead of being wiped.
            bot = read_json(BOT_FILE, strict=True)
            taken = {(r or {}).get("name") for r in bot.values()}
            for _ in range(20):
                name = request_channel_name(event.get("text") or "", taken)
                try:
                    created = await client.conversations_create(name=name, is_private=False)
                    break
                except SlackApiError as exc:
                    if exc.response.get("error") != "name_taken":
                        raise
                    taken.add(name)
            else:
                raise RuntimeError("no free request channel name")
            channel = created["channel"]["id"]
            bot[channel] = {"name": name, "requester": event["user"], "created": datetime.now(timezone.utc).isoformat()}
            _write(BOT_FILE, bot)
        return channel

    async def intake(client, event, body):
        user = event["user"]
        try:
            channel = await open_request_channel(client, event)
            await client.conversations_invite(channel=channel, users=user)
            try:
                await client.chat_postMessage(channel=channel, text=text(lang["code"], "acknowledge", user=user))
            except Exception as exc:
                logger.error("bot-channels: acknowledging %s in %s: %s", event.get("ts"), channel, exc)
            await client.chat_postMessage(channel=home, text=text(lang["code"], "opened", user=user, channel=channel))
        except Exception as exc:
            logger.error("bot-channels: request channel for %s: %s", event.get("ts"), exc)
            try:
                await client.chat_postMessage(channel=home, text=text(lang["code"], "open_failed", user=user))
            except Exception as post_exc:
                logger.error("bot-channels: telling %s: %s", user, post_exc)
            return
        # The message itself, as if it had been written in the new channel.
        copy = dict(event, channel=channel)
        try:
            await adapter._handle_slack_message(copy, dict(body, event=copy))
        except Exception as exc:
            logger.error("bot-channels: handing on %s: %s", event.get("ts"), exc)
            try:
                await client.chat_postMessage(channel=channel, text=text(lang["code"], "repeat", user=user))
            except Exception as post_exc:
                logger.error("bot-channels: asking %s to repeat in %s: %s", user, channel, post_exc)

    async def middleware(body, next, client):
        event = (body or {}).get("event") or {}
        try:
            refresh_prompts()
        except Exception as exc:
            logger.error("bot-channels: channel prompts: %s", exc)
        if not is_request(event):
            if is_open_channel_message(event):
                try:
                    # Hermes' own eyes lifecycle, which it otherwise runs only for mentions.
                    adapter._track_reacting_message(adapter._event_team_id(event, body), event["ts"])
                except Exception as exc:
                    logger.error("bot-channels: marking %s for the reaction: %s", event.get("ts"), exc)
            await next()
            return None
        ts = event.get("ts")
        if ts not in seen:
            seen.add(ts)
            task = asyncio.create_task(intake(client, event, body))
            tasks.add(task)
            task.add_done_callback(tasks.discard)
        # Acked, and kept from Hermes: the conversation happens in the request channel.
        return BoltResponse(status=200, body="")

    app.middleware(middleware)
    logger.info("bot-channels: serving %s and the bot's open channels", home)


def register(ctx):
    ctx.register_platform_handler("slack", factory)
