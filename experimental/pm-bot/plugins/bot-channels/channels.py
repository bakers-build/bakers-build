"""Core of the bot-channels plugin: request-channel names, the set of open bot channels,
the channel prompt, and the state-file read. No Hermes import.

shortcut: two copies of the slug rule (here and poller/channels.mjs), held together by
slug-examples.json; merge them if a third writer appears.
"""

import json
import logging
import re
import unicodedata

logger = logging.getLogger("pm_bot.bot_channels")

MAX_NAME = 40
_MENTION = re.compile(r"<[@#!][^>]*>")


def slug(text):
    """Lower-case words of ``text``, joined by ``-``, within Slack's channel-name rules."""
    plain = unicodedata.normalize("NFKD", str(text))
    plain = "".join(ch for ch in plain if not unicodedata.combining(ch)).lower()
    return re.sub(r"[^a-z0-9]+", "-", plain).strip("-")


def _cut(name, limit):
    if len(name) <= limit:
        return name
    boundary = name[: limit + 1].rfind("-")
    return name[: boundary if boundary > 0 else limit]


def request_channel_name(text, taken):
    """``req-<slug of the message's first words>``, at most 40 characters, ``-<n>`` when taken."""
    words = slug(_MENTION.sub(" ", text)) or "request"
    n = 1
    while True:
        suffix = f"-{n}" if n > 1 else ""
        name = _cut(f"req-{words}", MAX_NAME - len(suffix)) + suffix
        if name not in taken:
            return name
        n += 1


def open_channels(bot_channels, poller_state):
    """The bot's open channels: the request channels it opened (bot-channels.json) and the
    poller's channels (poller-state.json › channels, which holds the reopen channels), minus
    every channel the poller archived."""
    records = (poller_state or {}).get("channels") or {}
    known = set(bot_channels or {}) | set(records)
    return {c for c in known if not (records.get(c) or {}).get("archived")}


def channel_prompt(channel_id, workspace_url, ticket):
    """The trusted line Hermes puts before each turn in this channel: what the model cannot see."""
    link = f"{workspace_url.rstrip('/')}/archives/{channel_id}"
    return (
        f"This is the request channel {channel_id}. Its conversation link is {link}. "
        f"Its ticket: {ticket or 'none yet'}."
    )


def read_json(path, strict=False):
    """A state file's JSON, {} when it is missing. An unreadable file is logged and read as {},
    or raises when ``strict``: a caller that writes the file back must not wipe it."""
    try:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    except FileNotFoundError:
        return {}
    except (OSError, ValueError) as exc:
        if strict:
            raise
        logger.error("bot-channels: cannot read %s: %s", path, exc)
        return {}
