"""Recovery of a conversation a hard restart left paused, on Hermes' real session store with the
plugin registered. Needs Hermes (the pinned image); on plain python3 it is skipped, and
PM_BOT_REQUIRE_HERMES=1 (tests/contract/pm-bot-image.sh) turns that skip into a failure."""

import importlib.util
import os
import pathlib
import sys
import tempfile
import unittest

HERE = pathlib.Path(__file__).parent
sys.path.insert(0, "/opt/hermes")
try:
    import gateway.session_unattended_unknown as unattended
    from hermes_state import SessionDB
    from hermes_state_runtime import (RuntimeStoreError, admit_session_input, begin_runtime_epoch,
                                      claim_session_input, list_session_admissions, recover_session_inputs)
except ImportError as exc:
    if os.environ.get("PM_BOT_REQUIRE_HERMES") == "1":
        raise
    unattended = None
    missing = exc

PERSON = "slack:U123"


def load_plugin():
    if "bot_channels" in sys.modules:
        return sys.modules["bot_channels"]
    spec = importlib.util.spec_from_file_location("bot_channels", HERE / "__init__.py", submodule_search_locations=[str(HERE)])
    plugin = importlib.util.module_from_spec(spec)
    sys.modules["bot_channels"] = plugin
    spec.loader.exec_module(plugin)
    return plugin


class Ctx:
    def register_platform_handler(self, platform, factory):
        pass


@unittest.skipIf(unattended is None, "Hermes is not importable")
class RecoveryTest(unittest.TestCase):
    def setUp(self):
        original = unattended._unattended_unknown
        self.addCleanup(setattr, unattended, "_unattended_unknown", original)
        load_plugin().register(Ctx())
        self.db = SessionDB(pathlib.Path(tempfile.mkdtemp()) / "state.db")
        for sid in ("hung", "healthy", "live"):
            self.db.create_session(sid, source="slack")

    def statuses(self, sid):
        return [row["status"] for row in list_session_admissions(self.db, session_id=sid)]

    def test_a_requester_turn_lost_in_a_hard_restart_no_longer_blocks_the_next_message(self):
        # Owner 1 runs the requester's turn in "hung" and dies before settling it; "healthy" waits.
        e1 = begin_runtime_epoch(self.db, instance_id="owner-1")
        admit_session_input(self.db, epoch=e1, principal_id=PERSON, session_id="hung", request_id="r1", payload={"text": "make a ticket"})
        claim_session_input(self.db, epoch=e1, session_id="hung")
        admit_session_input(self.db, epoch=e1, principal_id=PERSON, session_id="healthy", request_id="r1", payload={"text": "hi"})

        # Owner 2 boots, as Hermes' gateway does after the container restarts.
        e2 = begin_runtime_epoch(self.db, instance_id="owner-2")
        recover_session_inputs(self.db, epoch=e2)
        # A turn of the new owner is running in "live".
        admit_session_input(self.db, epoch=e2, principal_id=PERSON, session_id="live", request_id="r1", payload={"text": "go on"})
        claim_session_input(self.db, epoch=e2, session_id="live")
        # The same selector the drain uses when it meets the lost turn on the next message.
        unattended.settle_recovered_unattended(self.db, e2)

        admit_session_input(self.db, epoch=e2, principal_id=PERSON, session_id="hung", request_id="r2", payload={"text": "hello?"})
        try:
            claimed = claim_session_input(self.db, epoch=e2, session_id="hung")
        except RuntimeStoreError as exc:
            self.fail(f"the hung conversation is still paused: {exc.reason}")
        self.assertEqual(claimed["request_id"], "r2")
        # Pending rows only: the lost turn is settled, not queued again.
        self.assertEqual(self.statuses("hung"), ["started"])
        self.assertEqual(self.statuses("healthy"), ["queued"])
        self.assertEqual(self.statuses("live"), ["started"])


if __name__ == "__main__":
    unittest.main()
