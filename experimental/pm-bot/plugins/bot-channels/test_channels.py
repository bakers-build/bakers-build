"""Tests of the plugin's pure core: python3 -m unittest discover -s experimental/pm-bot/plugins/bot-channels"""

import json
import pathlib
import unittest

from channels import channel_prompt, open_channels, request_channel_name, slug

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


if __name__ == "__main__":
    unittest.main()
