"""Thea tests never connect to the real Herdr server or install a real service."""

import fcntl
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

from test_setup import ROOT


@unittest.skipUnless(shutil.which("flock"), "requires flock")
class TheaTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="thea-test-")
        self.addCleanup(self.temp.cleanup)
        self.work = Path(self.temp.name)
        self.home = self.work / "home with spaces"
        self.thea = self.home / ".thea"
        (self.thea / ".pi").mkdir(parents=True)
        (self.thea / "AGENTS.md").symlink_to(ROOT / ".thea/AGENTS.md")
        (self.thea / ".pi/settings.json").symlink_to(ROOT / ".thea/.pi/settings.json")
        self.bin = self.work / "bin"
        self.bin.mkdir()
        self.command_log = self.work / "commands.log"
        self.herdr_log = self.work / "herdr.log"
        self.pi_log = self.work / "pi.json"
        self.state_file = self.work / "herdr.json"
        self.state_file.write_text(json.dumps({
            "workspaces": [{"workspace_id": "w1", "label": "Existing workers"}],
            "tabs": [], "panes": [],
        }))
        self.env = {
            "HOME": str(self.home), "PATH": str(self.bin) + ":" + os.environ["PATH"],
            "LC_ALL": "C", "TERM": "dumb",
            "MOCK_HERDR_STATE": str(self.state_file), "MOCK_HERDR_LOG": str(self.herdr_log),
            "MOCK_COMMAND_LOG": str(self.command_log), "MOCK_PI_LOG": str(self.pi_log),
            # A caller's named-session socket must never retarget the supervisor.
            "HERDR_SOCKET_PATH": "/not/the/shared/socket", "HERDR_ENV": "1",
        }
        shutil.copyfile(ROOT / "tests/fakes/herdr.py", self.bin / "herdr")
        (self.bin / "herdr").chmod(0o755)
        for name in ("systemctl", "systemd-run"):
            self.write_tool(name, '''import json, os, sys
from pathlib import Path
with Path(os.environ["MOCK_COMMAND_LOG"]).open("a") as log:
    log.write(json.dumps([Path(sys.argv[0]).name, *sys.argv[1:]]) + "\\n")
if "is-active" in sys.argv:
    sys.exit(0 if os.environ.get("MOCK_SERVICE_ACTIVE") else 1)
''')
        self.write_tool("pi", '''import json, os, sys
from pathlib import Path
Path(os.environ["MOCK_PI_LOG"]).write_text(json.dumps({
    "argv": sys.argv[1:], "cwd": os.getcwd(),
    "whatsapp_dir": os.environ.get("PI_WHATSAPP_DIR"),
    "allow": os.environ.get("WHATSAPP_ALLOW"),
    "agent_dir": os.environ.get("PI_CODING_AGENT_DIR"),
}))
''')
        self.write_tool("uname", 'print("Linux")\n')

    def write_tool(self, name, body):
        path = self.bin / name
        path.write_text("#!/usr/bin/env python3.11\n" + body)
        path.chmod(0o755)

    def run_thea(self, *args):
        return subprocess.run(
            ["bash", str(ROOT / "start-thea.sh"), *args], env=self.env,
            cwd=self.work, text=True, capture_output=True, timeout=30,
        )

    def assert_success(self, result):
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def calls(self, path):
        return [json.loads(line) for line in path.read_text().splitlines()] if path.exists() else []

    def state(self):
        return json.loads(self.state_file.read_text())

    def update_state(self, **values):
        state = self.state()
        state.update(values)
        self.state_file.write_text(json.dumps(state))

    def layout(self, agent=None, status="idle"):
        state = self.state()
        state["workspaces"].append({"workspace_id": "w99", "label": "Thea"})
        state["tabs"] = [{"tab_id": "w99:t1", "workspace_id": "w99", "label": "Thea"}]
        state["panes"] = [{"pane_id": "w99:p1", "tab_id": "w99:t1", "workspace_id": "w99",
                           "cwd": str(self.thea), "agent": agent, "agent_status": status}]
        self.state_file.write_text(json.dumps(state))

    def private_env(self):
        (self.thea / "state").mkdir(exist_ok=True)
        (self.thea / "state/env").write_text("WHATSAPP_ALLOW=447700900123\nTZ=UTC\n")

    def test_only_thea_declares_whatsapp(self):
        global_settings = json.loads((ROOT / "pi/.pi/agent/settings.json").read_text())
        settings = json.loads((ROOT / ".thea/.pi/settings.json").read_text())
        self.assertEqual(global_settings["packages"], [])
        self.assertEqual(settings["packages"], ["https://github.com/bensincs/pi-whatsapp"])

    @unittest.skipUnless(shutil.which("stow"), "requires GNU Stow")
    def test_stow_deploys_only_seeds_even_if_source_contains_private_growth(self):
        source = self.work / "source"
        shutil.copytree(ROOT / ".thea", source / ".thea")
        for relative in ("memory/MEMORY.md", "state/token", "unexpected.txt",
                         ".pi/skills/learned/SKILL.md", ".pi/git/package/private.txt"):
            path = source / ".thea" / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("private")
        target = self.work / "deployed"
        (target / ".pi").mkdir(parents=True)
        result = subprocess.run(
            [shutil.which("stow"), "--dir", str(source), "--target", str(target), ".thea"],
            env=self.env, text=True, capture_output=True, timeout=30,
        )
        self.assert_success(result)
        self.assertTrue((target / "AGENTS.md").is_symlink())
        self.assertTrue((target / ".pi/settings.json").is_symlink())
        for relative in ("memory", "state", "unexpected.txt", ".pi/skills", ".pi/git", ".stow-local-ignore"):
            self.assertFalse((target / relative).exists(), relative)

    def test_install_does_not_activate_and_preserves_learning(self):
        (self.thea / "memory").mkdir()
        memory = self.thea / "memory/MEMORY.md"
        memory.write_text("# Already learned\nDo not overwrite.\n")
        self.assert_success(self.run_thea("install"))
        self.assert_success(self.run_thea("install"))
        unit = self.home / ".config/systemd/user/thea.service"
        self.assertIn('WorkingDirectory=' + str(self.thea), unit.read_text())
        self.assertIn('scripts/thea.sh" supervise', unit.read_text())
        self.assertEqual(memory.read_text(), "# Already learned\nDo not overwrite.\n")
        self.assertTrue((self.thea / ".pi/skills").is_dir())
        self.assertTrue((self.thea / "tasks").is_dir())
        self.assertFalse((self.thea / "projects").exists())
        self.assertEqual((self.thea / "state/env").stat().st_mode & 0o777, 0o600)
        self.assertEqual(self.calls(self.command_log), [
            ["systemctl", "--user", "daemon-reload"],
            ["systemctl", "--user", "daemon-reload"],
        ])
        self.assertEqual(self.calls(self.herdr_log), [])

    @unittest.skipUnless(shutil.which("systemd-analyze"), "requires systemd-analyze")
    def test_generated_service_unit_is_valid(self):
        self.assert_success(self.run_thea("install"))
        unit = self.home / ".config/systemd/user/thea.service"
        result = subprocess.run(
            [shutil.which("systemd-analyze"), "verify", str(unit)],
            env=self.env, text=True, capture_output=True, timeout=30,
        )
        self.assert_success(result)

    def test_unmanaged_unit_is_not_overwritten(self):
        unit = self.home / ".config/systemd/user/thea.service"
        unit.parent.mkdir(parents=True)
        unit.write_text("# Someone else's unit\n")
        result = self.run_thea("install")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(unit.read_text(), "# Someone else's unit\n")
        self.assertEqual(self.calls(self.command_log), [])

    def test_folded_home_is_rejected(self):
        other = self.work / "checkout"
        other.mkdir()
        shutil.rmtree(self.thea)
        self.thea.symlink_to(other, target_is_directory=True)
        result = self.run_thea("install")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("must be real directories", result.stderr)
        self.assertEqual(list(other.iterdir()), [])

    def test_start_refuses_live_legacy_whatsapp(self):
        self.private_env()
        legacy = self.home / ".pi/agent/whatsapp"
        legacy.mkdir(parents=True)
        (legacy / "lock").write_text(str(os.getpid()))
        result = self.run_thea("start")
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Disconnect it first", result.stderr)
        self.assertFalse(any("enable" in call for call in self.calls(self.command_log)))
        self.assertEqual(self.calls(self.herdr_log), [])

    def test_migration_refuses_a_live_connection(self):
        legacy = self.home / ".pi/agent/whatsapp"
        (legacy / "auth").mkdir(parents=True)
        (legacy / "lock").write_text(str(os.getpid()))
        result = self.run_thea("migrate-whatsapp")
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse((self.thea / "state/whatsapp/auth").exists())

    def test_migration_preserves_original_and_omits_pid_lock(self):
        legacy = self.home / ".pi/agent/whatsapp"
        (legacy / "auth").mkdir(parents=True)
        (legacy / "auth/creds.json").write_text('{"test": true}')
        (legacy / "reminders.json").write_text("[]")
        (legacy / "lock").write_text("999999999")
        self.assert_success(self.run_thea("migrate-whatsapp"))
        target = self.thea / "state/whatsapp"
        self.assertEqual((target / "auth/creds.json").read_text(), '{"test": true}')
        self.assertTrue((legacy / "auth/creds.json").exists())
        self.assertFalse((target / "lock").exists())
        self.assertNotEqual(self.run_thea("migrate-whatsapp").returncode, 0)

    def test_run_uses_thea_profile_state_and_history(self):
        self.private_env()
        self.env["PI_CODING_AGENT_DIR"] = "/wrong/config"
        self.assert_success(self.run_thea("run"))
        pi = json.loads(self.pi_log.read_text())
        self.assertEqual(pi["cwd"], str(self.thea))
        self.assertEqual(pi["whatsapp_dir"], str(self.thea / "state/whatsapp"))
        self.assertIsNone(pi["agent_dir"])
        self.assertIn("--continue", pi["argv"])
        self.assertIn("--whatsapp", pi["argv"])
        self.assertIn(str(self.thea / "sessions"), pi["argv"])

    def test_second_pi_cannot_acquire_thea_lock(self):
        self.private_env()
        lock = self.thea / "state/pi.lock"
        with lock.open("w") as handle:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
            result = self.run_thea("run")
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse(self.pi_log.exists())

    def test_tick_creates_one_workspace_and_launches_only_thea(self):
        self.assert_success(self.run_thea("supervise", "--once"))
        calls = self.calls(self.herdr_log)
        self.assertEqual(sum(call[:2] == ["workspace", "create"] for call in calls), 1)
        launches = [call for call in calls if call[:2] == ["pane", "run"]]
        self.assertEqual(len(launches), 1)
        self.assertEqual(launches[0][2], "w99:p1")
        self.assertIn("scripts/thea.sh", launches[0][3])
        self.assertTrue((self.thea / "state/pane-id").exists())
        self.assertFalse(any(call[:2] in (["pane", "close"], ["server", "stop"]) for call in calls))

    def test_tick_never_restarts_a_live_pi_regardless_of_status(self):
        self.layout(agent="pi")
        for status in ("idle", "working", "blocked", "done", "unknown"):
            with self.subTest(status=status):
                state = self.state()
                state["panes"][0]["agent_status"] = status
                self.state_file.write_text(json.dumps(state))
                self.assert_success(self.run_thea("supervise", "--once"))
        calls = self.calls(self.herdr_log)
        self.assertFalse(any(call[:2] == ["pane", "run"] for call in calls))
        self.assertFalse(any(call[:2] == ["pane", "close"] for call in calls))

    def test_tick_leaves_ambiguous_workspaces_alone(self):
        self.layout()
        state = self.state()
        state["workspaces"].append({"workspace_id": "w3", "label": "Thea"})
        self.state_file.write_text(json.dumps(state))
        self.assert_success(self.run_thea("supervise", "--once"))
        calls = self.calls(self.herdr_log)
        self.assertFalse(any(call[:2] in (["pane", "run"], ["pane", "close"], ["workspace", "create"]) for call in calls))

    def test_tick_does_not_type_into_busy_or_unrelated_panes(self):
        self.layout()
        for changes in ({"foreground_busy": True}, {"named_elsewhere": True}):
            with self.subTest(changes=changes):
                self.update_state(**changes)
                self.assert_success(self.run_thea("supervise", "--once"))
        self.assertFalse(any(call[:2] == ["pane", "run"] for call in self.calls(self.herdr_log)))

    def test_stop_closes_only_the_validated_thea_pi(self):
        self.layout(agent="pi")
        self.private_env()
        (self.thea / "state/pane-id").write_text("w99:p1\n")
        self.assert_success(self.run_thea("stop"))
        self.assertEqual(self.state()["closed"], ["w99:p1"])
        calls = self.calls(self.herdr_log)
        self.assertFalse(any(call[:2] == ["server", "stop"] for call in calls))

    def test_stop_does_not_close_a_reused_or_stale_pane(self):
        self.layout(agent="pi")
        self.private_env()
        (self.thea / "state/pane-id").write_text("w1:p1\n")
        self.assert_success(self.run_thea("stop"))
        self.assertFalse(self.state().get("closed"))

    def test_stop_does_not_close_a_pane_with_changed_ownership(self):
        self.layout(agent="pi")
        self.private_env()
        (self.thea / "state/pane-id").write_text("w99:p1\n")
        state = self.state()
        state["panes"][0]["cwd"] = "/another/repository"
        self.state_file.write_text(json.dumps(state))
        self.assert_success(self.run_thea("stop"))
        self.assertFalse(self.state().get("closed"))

    def test_private_growth_is_ignored_but_seed_files_are_trackable(self):
        for path in (".thea/memory/MEMORY.md", ".thea/tasks/work.md",
                     ".thea/state/whatsapp/auth/creds.json", ".thea/.pi/skills/test/SKILL.md"):
            result = subprocess.run(
                ["git", "check-ignore", "--no-index", path], cwd=ROOT, env=self.env,
                text=True, capture_output=True, timeout=10,
            )
            self.assert_success(result)
        for path in (".thea/AGENTS.md", ".thea/.pi/settings.json"):
            result = subprocess.run(
                ["git", "check-ignore", "--no-index", path], cwd=ROOT, env=self.env,
                text=True, capture_output=True, timeout=10,
            )
            self.assertEqual(result.returncode, 1, result.stdout + result.stderr)

    def test_missing_server_is_started_in_a_separate_unit(self):
        self.update_state(server="not running")
        self.assert_success(self.run_thea("supervise", "--once"))
        calls = self.calls(self.command_log)
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0][0], "systemd-run")
        self.assertIn("--unit=herdr-server", calls[0])
        self.assertNotIn("stop", calls[0])
        self.assertNotIn("restart", calls[0])
        self.assertEqual(self.state()["workspaces"][0]["label"], "Existing workers")


if __name__ == "__main__":
    unittest.main()
