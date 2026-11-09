"""The PM bot's Slack channels, as a Hermes plugin (experimental/pm-bot/README.md › How it works).

- Intake: a mention of the bot at the top of its channel (SLACK_ALLOWED_CHANNELS, one ID) opens
  a public request channel, invites the sender, links it in a flat reply and hands the message
  on to Hermes there. The bot's channel itself holds no conversation.
- Admission: Hermes answers only in the bot's channel and in its open channels, the request
  channels this plugin opened plus the poller's reopen channels, minus the archived ones; in an
  open channel without a mention.
- Channel prompt: each open channel gets a trusted line with its ID, conversation link and
  ticket, which the model cannot see otherwise.

This plugin writes $HERMES_HOME/bot-channels.json; the poller writes poller-state.json. Each
reads the other's file and writes only its own.
"""

import asyncio
import json
import logging
import os
import re
from datetime import datetime, timezone

from .channels import channel_prompt, open_channels, request_channel_name

logger = logging.getLogger("pm_bot.bot_channels")

DATA = os.environ.get("HERMES_HOME") or "/opt/data"
BOT_FILE = os.path.join(DATA, "bot-channels.json")
POLLER_FILE = os.path.join(DATA, "poller-state.json")


def _read(path):
    try:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    except FileNotFoundError:
        return {}
    except (OSError, ValueError) as exc:
        logger.error("bot-channels: cannot read %s: %s", path, exc)
        return {}


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

    home = (os.environ.get("SLACK_ALLOWED_CHANNELS") or "").strip()
    workspace = os.environ.get("SLACK_WORKSPACE_URL") or ""
    allowed_users = _users(os.environ.get("SLACK_ALLOWED_USERS"))
    if not home:
        logger.error("bot-channels: SLACK_ALLOWED_CHANNELS is empty; the plugin stays off")
        return

    def current():
        poller = _read(POLLER_FILE)
        return poller, open_channels(_read(BOT_FILE), poller)

    # Instance overrides of the adapter's channel getters (shadowing the class's env/YAML
    # readers): read on every message, so a new channel is admitted at once and an archived
    # one drops out. entrypoint.sh check asserts both getters exist.
    adapter._slack_allowed_channels = lambda: {home} | current()[1]
    adapter._slack_free_response_channels = lambda: current()[1]

    def refresh_prompts():
        poller, channels = current()
        records = poller.get("channels") or {}
        prompts = adapter.config.extra.setdefault("channel_prompts", {})
        for channel in channels:
            prompts[channel] = channel_prompt(channel, workspace, (records.get(channel) or {}).get("ticket"))

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

    lock = asyncio.Lock()
    seen = set()  # a mention arrives as message and as app_mention, with one ts
    tasks = set()

    async def open_request_channel(client, event):
        async with lock:
            bot = _read(BOT_FILE)
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
            await client.chat_postMessage(channel=home, text=f"<@{user}> I opened <#{channel}> for this request. Let's continue there.")
        except Exception as exc:
            logger.error("bot-channels: request channel for %s: %s", event.get("ts"), exc)
            try:
                await client.chat_postMessage(channel=home, text=f"<@{user}> I could not open a channel for this request. Please try again in a moment.")
            except Exception:
                pass
            return
        # The message itself, as if it had been written in the new channel.
        copy = dict(event, channel=channel)
        try:
            await adapter._handle_slack_message(copy, dict(body, event=copy))
        except Exception as exc:
            logger.error("bot-channels: handing on %s: %s", event.get("ts"), exc)
            await client.chat_postMessage(channel=channel, text=f"<@{user}>, please repeat your request here.")

    async def middleware(body, next, client):
        event = (body or {}).get("event") or {}
        try:
            refresh_prompts()
        except Exception as exc:
            logger.error("bot-channels: channel prompts: %s", exc)
        if not is_request(event):
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
