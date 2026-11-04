"""Setup regression tests. All writes are confined to temporary directories."""

import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import tomllib
import unittest


ROOT = Path(__file__).resolve().parents[1]
ZSH = shutil.which("zsh")
STOW = shutil.which("stow")


class SetupTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="dotfiles-test-")
        self.addCleanup(self.temp.cleanup)
        self.work = Path(self.temp.name)
        self.home = self.work / "home"
        self.home.mkdir()
        self.env = {
            "HOME": str(self.home),
            "PATH": os.environ.get("PATH", "/usr/bin:/bin"),
            "TERM": "dumb",
            "LC_ALL": "C",
        }

    def run_command(self, command, **kwargs):
        return subprocess.run(
            command, cwd=self.work, env=self.env, text=True,
            capture_output=True, timeout=30, **kwargs,
        )

    def assert_success(self, result):
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_shell_syntax(self):
        for path in [ROOT / "bootstrap.sh", ROOT / "start-thea.sh",
                     *ROOT.glob("scripts/*.sh"), *ROOT.glob("zsh/.config/zsh/*.sh")]:
            with self.subTest(path=path):
                self.assert_success(self.run_command(["bash", "-n", str(path)]))
        if ZSH:
            for path in (ROOT / "zsh/.zshenv", ROOT / "zsh/.zshrc"):
                self.assert_success(self.run_command([ZSH, "-n", str(path)]))

    def test_documented_shell_syntax(self):
        for name in ("README.md", "AGENTS.md"):
            blocks = re.findall(r"```bash\n(.*?)```", (ROOT / name).read_text(), re.DOTALL)
            self.assertTrue(blocks, name)
            for index, block in enumerate(blocks):
                with self.subTest(document=name, block=index):
                    self.assert_success(self.run_command(["bash", "-n"], input=block))

    def test_configuration_formats(self):
        for package in ("pi", ".thea", "copilot", "nvim", "herdr", "starship", "bottom"):
            for path in (ROOT / package).rglob("*"):
                if "skills" in path.parts or path.suffix not in (".json", ".toml"):
                    continue
                with self.subTest(path=path), path.open("rb") as source:
                    if path.suffix == ".json":
                        json.load(source)
                    else:
                        tomllib.load(source)

    @unittest.skipUnless(ZSH, "requires zsh")
    def test_shell_path_history_and_local_overrides(self):
        marker = str(self.work / "custom-bin")
        self.env["PATH"] = marker + ":" + marker + ":" + self.env["PATH"]
        self.env["EDITOR"] = "my-editor"
        self.env["ASDF_DATA_DIR"] = str(self.work / "asdf-data")
        (self.home / ".zshenv.local").write_text("export TEST_ENV_OVERRIDE=loaded\n")
        (self.home / ".zshrc.local").write_text("export TEST_RC_OVERRIDE=loaded\n")
        script = '''
# Skip external integrations while loading the actual startup files.
command() { return 1; }
source "$1/zsh/.zshenv" || exit 1
source "$1/zsh/.zshenv" || exit 1
source "$1/zsh/.zshrc" || exit 1
print -r -- "$PATH"
print -r -- "$HISTFILE"
print -r -- "$EDITOR"
print -r -- "$TEST_ENV_OVERRIDE:$TEST_RC_OVERRIDE"
print -s -- dotfiles-history-test
fc -W
'''
        result = self.run_command([ZSH, "-d", "-f", "-i", "-c", script, "test", str(ROOT)])
        self.assert_success(result)
        path, history, editor, overrides = result.stdout.splitlines()
        entries = path.split(":")
        self.assertEqual(entries.count(marker), 1)
        self.assertIn(str(self.home / ".local/bin"), entries)
        self.assertIn(str(self.home / ".cargo/bin"), entries)
        self.assertIn(str(self.work / "asdf-data/shims"), entries)
        self.assertEqual(history, str(self.home / ".zsh_history"))
        self.assertIn("dotfiles-history-test", Path(history).read_text())
        self.assertEqual(editor, "my-editor")
        self.assertEqual(overrides, "loaded:loaded")

    @unittest.skipUnless(ZSH, "requires zsh")
    def test_shell_loads_without_local_overrides_or_code_alias(self):
        script = '''
command() { return 1; }
source "$1/zsh/.zshenv" || exit 1
source "$1/zsh/.zshrc" || exit 1
[[ "$EDITOR" == nvim ]] || exit 1
if alias code >/dev/null 2>&1; then exit 1; fi
(( ${+functions[diffwatch]} )) || exit 1
(( ! ${+functions[oc]} && ! ${+functions[aicode]} )) || exit 1
'''
        self.assert_success(self.run_command([ZSH, "-d", "-f", "-c", script, "test", str(ROOT)]))

    def test_portable_git_credentials_and_editor(self):
        for host in ("github.com", "gist.github.com"):
            result = self.run_command([
                "git", "config", "--file", str(ROOT / "git/.gitconfig"),
                "--get-all", "credential.https://" + host + ".helper",
            ])
            self.assert_success(result)
            self.assertEqual(result.stdout.splitlines(), ["", "!gh auth git-credential"])
        result = self.run_command([
            "git", "config", "--file", str(ROOT / "git/.gitconfig"), "--get", "core.editor",
        ])
        self.assert_success(result)
        self.assertEqual(result.stdout.strip(), "nvim")

    def test_removed_agent_integrations(self):
        self.assertNotIn('brew "opencode"', (ROOT / "Brewfile").read_text())
        self.assertFalse((ROOT / "zsh/.config/zsh/aicode.sh").exists())
        with (ROOT / "herdr/.config/herdr/config.toml").open("rb") as source:
            config = tomllib.load(source)
        bindings = config["keys"].get("command", [])
        self.assertNotIn("prefix+i", [binding["key"] for binding in bindings])
        result = self.run_command([
            "git", "config", "--file", str(ROOT / "git/.gitconfig"), "--get", "alias.ai",
        ])
        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)

    def test_private_shell_overrides_are_ignored(self):
        self.assert_success(self.run_command(["git", "init", "-q"]))
        for name in (".zshenv.local", ".zshrc.local"):
            self.assert_success(self.run_command([
                "git", "-c", "core.excludesfile=" + str(ROOT / "git/.gitignore_global"),
                "check-ignore", "--no-index", name,
            ]))

    def mock_bootstrap_tools(self, platform):
        # Never invoke a real package manager, installer, account CLI, or Neovim.
        bin_dir = self.work / "bin"
        bin_dir.mkdir(exist_ok=True)
        for name in ("brew", "az", "nvim"):
            tool = bin_dir / name
            tool.write_text("#!/bin/sh\nexit 0\n")
            tool.chmod(0o755)
        uname = bin_dir / "uname"
        uname.write_text("#!/bin/sh\nprintf '%s\\n' '" + platform + "'\n")
        uname.chmod(0o755)
        self.env["PATH"] = str(bin_dir) + ":" + self.env["PATH"]

    @unittest.skipUnless(STOW, "requires GNU Stow")
    def test_bootstrap_links_home_and_can_repeat(self):
        for platform in ("Linux", "Darwin"):
            with self.subTest(platform=platform):
                home = self.work / platform
                home.mkdir()
                self.env["HOME"] = str(home)
                self.mock_bootstrap_tools(platform)
                for _ in range(2):
                    result = self.run_command(["bash", str(ROOT / "bootstrap.sh")])
                    self.assert_success(result)
                self.assertEqual((home / ".gitconfig").resolve(), ROOT / "git/.gitconfig")
                self.assertEqual((home / ".zshrc").resolve(), ROOT / "zsh/.zshrc")
                self.assertEqual((home / ".thea/AGENTS.md").resolve(), ROOT / ".thea/AGENTS.md")
                self.assertEqual((home / ".thea/.pi/settings.json").resolve(), ROOT / ".thea/.pi/settings.json")
                for relative in (".config/herdr", ".pi/agent", ".copilot", ".thea", ".thea/.pi"):
                    self.assertTrue((home / relative).is_dir())
                    self.assertFalse((home / relative).is_symlink())
                self.assertEqual((home / ".config/kitty").exists(), platform == "Darwin")
                for path in home.rglob("*"):
                    if path.is_symlink():
                        self.assertTrue(path.exists(), str(path))

    @unittest.skipUnless(STOW, "requires GNU Stow")
    def test_thea_conflict_prevents_all_normal_package_links(self):
        profile = self.home / ".thea/.pi"
        profile.mkdir(parents=True)
        settings = profile / "settings.json"
        settings.write_text('{"existing": true}\n')
        self.mock_bootstrap_tools("Linux")
        result = self.run_command(["bash", str(ROOT / "bootstrap.sh")])
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("No packages were stowed", result.stderr)
        self.assertFalse((self.home / ".gitconfig").is_symlink())
        self.assertFalse((self.home / ".thea/AGENTS.md").is_symlink())
        self.assertEqual(settings.read_text(), '{"existing": true}\n')

    @unittest.skipUnless(STOW, "requires GNU Stow")
    def test_bootstrap_conflicts_do_not_partially_stow(self):
        original = "# existing machine configuration\n"
        (self.home / ".zshrc").write_text(original)
        self.mock_bootstrap_tools("Linux")
        result = self.run_command(["bash", str(ROOT / "bootstrap.sh")])
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("No packages were stowed", result.stderr)
        self.assertEqual((self.home / ".zshrc").read_text(), original)
        self.assertFalse((self.home / ".gitconfig").is_symlink())
        self.assertFalse((self.home / ".tmux.conf").is_symlink())
        self.assertFalse((self.home / ".config/nvim").is_symlink())


if __name__ == "__main__":
    unittest.main()
