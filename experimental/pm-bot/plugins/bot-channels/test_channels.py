"""Tests of the plugin's pure core: python3 -m unittest discover -s experimental/pm-bot/plugins/bot-channels"""

import json
import pathlib
import tempfile
import unittest

from channels import channel_prompt, language_prompt, open_channels, read_json, request_channel_name, slug, text

HERE = pathlib.Path(__file__).parent


class Slug(unittest.TestCase):
    def test_shared_examples(self):
        # The same examples the poller's slug passes (poller/channels.test.mjs).
        for text, expected in json.loads((HERE / "slug-examples.json").read_text()):
            self.assertEqual(slug(text), expected, text)


class RequestChannelName(unittest.TestCase):
    def test_first_words_without_the_mention(self):
        self.assertEqual(request_channel_name("<@U0BOT> Please switch the font to Comic Sans", set()), "req-please-switch-the-font-to-comic-sans")

    def test_cut_at_a_word_boundary_within_40(self):
        name = request_channel_name("<@U0BOT> we need the opening hours of every studio on the start page", set())
        self.assertEqual(name, "req-we-need-the-opening-hours-of-every")
        self.assertLessEqual(len(name), 40)

    def test_taken_names_get_a_number(self):
        taken = {"req-comic-sans", "req-comic-sans-2"}
        self.assertEqual(request_channel_name("<@U0BOT> comic sans", taken), "req-comic-sans-3")

    def test_no_words_still_gives_a_name(self):
        self.assertEqual(request_channel_name("<@U0BOT> ???", set()), "req-request")


class OpenChannels(unittest.TestCase):
    def test_own_channels_and_reopen_channels_without_archived_ones(self):
        bot = {"C1": {"name": "req-a"}, "C2": {"name": "req-b"}}
        poller = {"channels": {"C2": {"archived": True}, "C3": {"ticket": "YF-12", "previous": "C2"}}}
        self.assertEqual(open_channels(bot, poller), {"C1", "C3"})

    def test_a_channel_in_neither_file_is_never_open(self):
        # Another project's channel, or one the bot was merely added to.
        self.assertNotIn("C9", open_channels({"C1": {}}, {"channels": {}}))

    def test_missing_files_mean_no_channels(self):
        self.assertEqual(open_channels({}, {}), set())


class ChannelPrompt(unittest.TestCase):
    def test_carries_id_link_and_ticket(self):
        prompt = channel_prompt("C1", "https://acme.slack.com/", "YF-12")
        self.assertIn("C1", prompt)
        self.assertIn("https://acme.slack.com/archives/C1", prompt)
        self.assertIn("YF-12", prompt)

    def test_without_a_ticket_says_none_yet(self):
        self.assertIn("none yet", channel_prompt("C1", "https://acme.slack.com", None))

    def test_names_the_language_german_by_default(self):
        self.assertTrue(channel_prompt("C1", "https://acme.slack.com", None).endswith("Answer in the language with ISO 639-1 code `de`."))
        self.assertTrue(channel_prompt("C1", "https://acme.slack.com", "YF-12", "fr").endswith("Answer in the language with ISO 639-1 code `fr`."))

    def test_carries_the_requesters_email_address_or_none(self):
        prompt = channel_prompt("C1", "https://acme.slack.com", "YF-12", "de", "ada@example.test")
        self.assertIn("Its requester's e-mail address: ada@example.test.", prompt)
        self.assertTrue(prompt.endswith("Answer in the language with ISO 639-1 code `de`."))
        self.assertIn("Its requester's e-mail address: none.", channel_prompt("C1", "https://acme.slack.com", None))

    def test_the_main_channel_line_names_the_language_only(self):
        self.assertEqual(language_prompt("en"), "Answer in the language with ISO 639-1 code `en`.")


class ReadJson(unittest.TestCase):
    def test_a_missing_file_is_empty(self):
        self.assertEqual(read_json("/nonexistent/bot-channels.json", strict=True), {})

    def test_an_unreadable_file_is_empty_for_admission_and_an_error_for_intake(self):
        # Intake rewrites the file from what it read: an empty read would wipe every channel.
        with tempfile.TemporaryDirectory() as d:
            path = pathlib.Path(d, "bot-channels.json")
            path.write_text('{"C1": {"name": "req-', encoding="utf-8")
            with self.assertLogs("pm_bot.bot_channels", "ERROR"):
                self.assertEqual(read_json(path), {})
            with self.assertRaises(ValueError):
                read_json(path, strict=True)


class Texts(unittest.TestCase):
    def test_every_text_exists_in_german_and_english(self):
        messages = json.loads((HERE / "messages.json").read_text(encoding="utf-8"))
        self.assertEqual(set(messages), {"de", "en"})
        self.assertEqual(set(messages["de"]), set(messages["en"]))
        self.assertEqual(set(messages["de"]), {"acknowledge", "opened", "open_failed", "repeat"})

    def test_placeholders_are_filled_in_the_language(self):
        self.assertEqual(text("en", "opened", user="U1", channel="C1"), "<@U1> I opened <#C1> for this request. Let's continue there.")
        self.assertEqual(text("de", "repeat", user="U1"), "<@U1>, bitte schreib deine Anfrage hier noch einmal.")

    def test_a_language_without_texts_falls_back_to_german(self):
        self.assertEqual(text("fr", "repeat", user="U1"), text("de", "repeat", user="U1"))

    def test_the_acknowledgement_mentions_the_requester_in_each_language(self):
        for code in ("de", "en"):
            self.assertTrue(text(code, "acknowledge", user="U1").startswith("<@U1> "))


if __name__ == "__main__":
    unittest.main()
