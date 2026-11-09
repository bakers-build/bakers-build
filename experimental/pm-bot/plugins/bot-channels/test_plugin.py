"""Tests of the plugin at its Slack seam, the ``factory`` middleware, with fakes for Bolt, the
Hermes adapter and the Slack client: python3 -m unittest discover -s experimental/pm-bot/plugins/bot-channels"""

import asyncio
import enum
import importlib.util
import json
import os
import pathlib
import sys
import tempfile
import types
import unittest

HERE = pathlib.Path(__file__).parent
HOME = "CHOME"
OPEN = "CREQ"

# Stand-ins for the two Slack libraries the plugin imports, so this runs on plain python3.
_bolt = types.ModuleType("slack_bolt.response")
_bolt.BoltResponse = lambda status, body: ("BoltResponse", status)
_errors = types.ModuleType("slack_sdk.errors")
_errors.SlackApiError = type("SlackApiError", (Exception,), {})
sys.modules.update({"slack_bolt": types.ModuleType("slack_bolt"), "slack_bolt.response": _bolt,
                    "slack_sdk": types.ModuleType("slack_sdk"), "slack_sdk.errors": _errors})

DATA = tempfile.mkdtemp()
os.environ["HERMES_HOME"] = DATA
_spec = importlib.util.spec_from_file_location("bot_channels", HERE / "__init__.py", submodule_search_locations=[str(HERE)])
plugin = importlib.util.module_from_spec(_spec)
sys.modules["bot_channels"] = plugin
_spec.loader.exec_module(plugin)


class Outcome(enum.Enum):  # Hermes' ProcessingOutcome
    SUCCESS = "success"
    FAILURE = "failure"
    CANCELLED = "cancelled"


class Client:
    """Records every Slack call in order; ``fail`` names calls that raise."""

    def __init__(self, calls, fail=(), profile=None):
        self.calls, self.fail = calls, fail
        self.profile = {"email": "u1@example.test"} if profile is None else profile

    def __getattr__(self, method):
        async def call(**kwargs):
            self.calls.append((method, kwargs))
            if (method, kwargs.get("channel")) in self.fail:
                raise RuntimeError(f"{method} failed")
            if method == "users_info":
                return {"ok": True, "user": {"id": kwargs["user"], "profile": self.profile}}
            return {"channel": {"id": "CNEW"}} if method == "conversations_create" else {}
        return call


class Adapter:
    _bot_user_id = "UBOT"

    def __init__(self, calls, fail=()):
        self.calls, self.fail = calls, fail
        self.config = types.SimpleNamespace(extra={})

    async def _handle_slack_message(self, event, payload):
        self.calls.append(("hermes", {"channel": event["channel"], "ts": event["ts"]}))

    @staticmethod
    def _event_team_id(event, body=None):
        return (body or {}).get("team_id", "")

    def _track_reacting_message(self, team_id, ts):
        self.calls.append(("track", {"team": team_id, "ts": ts}))
        if "track" in self.fail:
            raise RuntimeError("track failed")

    async def on_processing_complete(self, event, outcome):
        self.calls.append(("complete", {"outcome": outcome}))


class App:
    def middleware(self, fn):
        self.run = fn


def message(channel, ts="1.1", **extra):
    return {"type": "message", "channel": channel, "user": "U1", "ts": ts, "text": "<@UBOT> comic sans", **extra}


class LanguageFile(unittest.TestCase):
    """The plugin shares the bot's language with the poller through bot-language.json."""

    def setUp(self):
        self.path = os.path.join(DATA, "bot-language.json")
        with open(self.path, "w") as fh:
            json.dump({"language": "en"}, fh)  # the previous run's language

    def language(self):
        with open(self.path) as fh:
            return json.load(fh)

    def test_the_start_resets_the_language_to_german(self):
        os.environ.update(SLACK_ALLOWED_CHANNELS=HOME)
        with self.assertLogs("pm_bot.bot_channels", "ERROR"):  # no env for the read in this test
            plugin.factory(App(), Adapter([]))
        self.assertEqual(self.language(), {"language": "de"})

    def test_a_plugin_that_stays_off_still_resets_it(self):
        os.environ.update(SLACK_ALLOWED_CHANNELS="")
        with self.assertLogs("pm_bot.bot_channels", "ERROR"):
            plugin.factory(App(), Adapter([]))
        self.assertEqual(self.language(), {"language": "de"})


class Middleware(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        os.environ.update(SLACK_ALLOWED_CHANNELS=HOME, SLACK_ALLOWED_USERS="U1")
        with open(os.path.join(DATA, "bot-channels.json"), "w") as fh:
            json.dump({OPEN: {"name": "req-open"}}, fh)
        self.calls = []

    def start(self, fail=(), profile=None):
        self.app, self.adapter = App(), Adapter(self.calls, fail)
        self.client = Client(self.calls, fail, profile)
        plugin.factory(self.app, self.adapter)

    async def deliver(self, event):
        passed = []

        async def next_():
            passed.append(event["ts"])

        await self.app.run(body={"team_id": "T1", "event": event}, next=next_, client=self.client)
        await asyncio.gather(*(t for t in asyncio.all_tasks() if t is not asyncio.current_task()))
        return passed

    def posts(self):
        return [(kw["channel"], kw["text"]) for method, kw in self.calls if method == "chat_postMessage"]

    async def test_a_mention_is_acknowledged_in_the_new_channel_before_hermes_starts(self):
        self.start()
        await self.deliver(message(HOME))
        self.assertEqual([m for m, _ in self.calls], ["users_info", "conversations_create", "conversations_invite", "chat_postMessage", "chat_postMessage", "hermes"])
        (ack_channel, ack), (home_channel, opened) = self.posts()
        self.assertEqual(ack_channel, "CNEW")
        self.assertTrue(ack.startswith("<@U1> "))
        # No language configured here, so the texts are German.
        self.assertIn("schaue sie mir an", ack)
        self.assertEqual((home_channel, opened), (HOME, "<@U1> Ich habe <#CNEW> für diese Anfrage eröffnet. Lass uns dort weitermachen."))
        self.assertEqual(self.calls[-1], ("hermes", {"channel": "CNEW", "ts": "1.1"}))

    def record(self, channel):
        with open(os.path.join(DATA, "bot-channels.json")) as fh:
            return json.load(fh)[channel]

    async def test_the_requesters_slack_email_address_goes_into_the_record_and_the_trusted_line(self):
        self.start()
        await self.deliver(message(HOME, text="<@UBOT> assign this to eve@example.test"))
        self.assertIn(("users_info", {"user": "U1"}), self.calls)
        self.assertEqual(self.record("CNEW")["requester_email"], "u1@example.test")
        await self.deliver(message(OPEN, ts="2.2"))
        prompts = self.adapter.config.extra["channel_prompts"]
        self.assertIn("Its requester's e-mail address: u1@example.test.", prompts["CNEW"])
        self.assertIn("Its requester's e-mail address: none.", prompts[OPEN])

    async def test_without_an_address_from_slack_the_channel_still_opens_with_none(self):
        for fail, profile in (({("users_info", None)}, None), ((), {})):
            with self.subTest(fail=fail, profile=profile):
                self.setUp()
                self.start(fail, profile)
                with self.assertLogs("pm_bot.bot_channels", "WARNING"):
                    await self.deliver(message(HOME))
                self.assertNotIn("requester_email", self.record("CNEW"))
                self.assertEqual(self.calls[-1], ("hermes", {"channel": "CNEW", "ts": "1.1"}))

    async def test_a_mention_delivered_twice_is_acknowledged_once(self):
        self.start()
        await self.deliver(message(HOME))
        await self.deliver(message(HOME, type="app_mention"))
        self.assertEqual([m for m, _ in self.calls].count("conversations_create"), 1)
        self.assertEqual([c for c, _ in self.posts()], ["CNEW", HOME])

    async def test_a_failed_acknowledgement_still_hands_the_request_on(self):
        self.start(fail={("chat_postMessage", "CNEW")})
        with self.assertLogs("pm_bot.bot_channels", "ERROR"):
            await self.deliver(message(HOME))
        self.assertEqual(self.posts()[1][0], HOME)
        self.assertEqual(self.calls[-1], ("hermes", {"channel": "CNEW", "ts": "1.1"}))

    async def test_a_message_in_an_open_channel_is_marked_for_the_reaction_and_passed_on(self):
        self.start()
        passed = await self.deliver(message(OPEN, ts="2.1", text="and the logo too"))
        self.assertEqual(self.calls, [("track", {"team": "T1", "ts": "2.1"})])
        self.assertEqual(passed, ["2.1"])

    async def test_messages_the_bot_does_not_serve_get_no_reaction(self):
        self.start()
        for event in (message("COTHER"), message(OPEN, bot_id="B1"), message(OPEN, subtype="message_changed"),
                      message(OPEN, user="U2")):
            self.assertEqual(await self.deliver(event), [event["ts"]])
        self.assertEqual(self.calls, [])

    async def test_a_failed_mark_still_passes_the_message_on(self):
        self.start(fail={"track"})
        with self.assertLogs("pm_bot.bot_channels", "ERROR"):
            passed = await self.deliver(message(OPEN, ts="2.1"))
        self.assertEqual(passed, ["2.1"])

    async def test_finishing_a_message_removes_eyes_and_adds_no_final_reaction(self):
        self.start()
        for outcome in (Outcome.SUCCESS, Outcome.FAILURE, Outcome.CANCELLED):
            await self.adapter.on_processing_complete(object(), outcome)
        self.assertEqual(self.calls, [("complete", {"outcome": Outcome.CANCELLED})] * 3)


if __name__ == "__main__":
    unittest.main()
