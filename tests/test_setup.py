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
REX = shutil.which("rex")


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
        for path in [ROOT / "bootstrap.sh", *ROOT.glob("zsh/.config/zsh/*.sh")]:
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
        for package in ("pi", "copilot", "nvim", "starship", "bottom"):
            for path in (ROOT / package).rglob("*"):
                if "skills" in path.parts or path.suffix not in (".json", ".toml"):
                    continue
                with self.subTest(path=path), path.open("rb") as source:
                    if path.suffix == ".json":
                        json.load(source)
                    else:
                        tomllib.load(source)

    def test_rex_palette_matches_kitty(self):
        kitty = (ROOT / "kitty/.config/kitty/kitty.conf").read_text()
        theme = (ROOT / "rex/.config/rex/themes/Kitty Solarized Dark").read_text()
        colors = dict(re.findall(r"^(\w+)\s+(#[0-9a-f]{6})$", kitty, re.MULTILINE))
        palette = dict(re.findall(r"^palette = (\d+)=(#[0-9a-f]{6})$", theme, re.MULTILINE))
        self.assertEqual(len(palette), 16)
        for index in range(16):
            self.assertEqual(palette[str(index)], colors["color" + str(index)])
        for rex_key, kitty_key in (
            ("background", "background"), ("foreground", "foreground"),
            ("cursor-color", "cursor"), ("cursor-text", "cursor_text_color"),
        ):
            self.assertIn(rex_key + " = " + colors[kitty_key], theme)

    @unittest.skipUnless(REX, "requires Rex")
    def test_rex_configuration_loads_without_errors(self):
        result = self.run_command([
            REX, "config", "check", str(ROOT / "rex/.config/rex/init.lua"),
        ])
        self.assert_success(result)
        self.assertNotIn("warning", result.stdout.lower() + result.stderr.lower())

    def test_herdr_is_not_configured(self):
        for name in ("Brewfile", "bootstrap.sh", "README.md", "AGENTS.md"):
            self.assertNotIn("herdr", (ROOT / name).read_text().lower(), name)
        self.assertFalse((ROOT / "herdr").exists())
        self.assertFalse((ROOT / "herdr-app").exists())

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

    def test_whatsapp_is_not_in_shared_pi_settings(self):
        settings = json.loads((ROOT / "pi/.pi/agent/settings.json").read_text())
        self.assertNotIn("https://github.com/bensincs/pi-whatsapp", settings.get("packages", []))

    def test_removed_agent_integrations(self):
        self.assertNotIn('brew "opencode"', (ROOT / "Brewfile").read_text())
        self.assertFalse((ROOT / "zsh/.config/zsh/aicode.sh").exists())
        result = self.run_command([
            "git", "config", "--file", str(ROOT / "git/.gitconfig"), "--get", "alias.ai",
        ])
        self.assertEqual(result.returncode, 1, result.stdout + result.stderr)

    def test_private_shell_overrides_are_ignored(self):
        self.assert_success(self.run_command(["git", "init", "-q"]))
        for name in (
            ".zshenv.local", ".zshrc.local", ".me/settings", ".local/settings",
            "project/.me/icon.svg", "project/.local/settings",
        ):
            self.assert_success(self.run_command([
                "git", "-c", "core.excludesfile=" + str(ROOT / "git/.gitignore_global"),
                "check-ignore", "--no-index", name,
            ]))

    def mock_bootstrap_tools(self, platform):
        # Never invoke a real package manager, installer, account CLI, or Neovim.
        bin_dir = self.work / "bin"
        bin_dir.mkdir(exist_ok=True)
        self.env["TEST_BOOTSTRAP_LOG"] = str(self.work / "bootstrap.log")
        Path(self.env["TEST_BOOTSTRAP_LOG"]).write_text("")
        log_command = '''#!/bin/sh
printf '%s %s\\n' "${0##*/}" "$*" >> "$TEST_BOOTSTRAP_LOG"
'''
        scripts = {
            name: "exit 0\n"
            for name in ("brew", "az", "uv", "nvim", "open", "sleep", "rex")
        }
        scripts["curl"] = '''[ "$*" = "-fsSL https://pkgs.superlogical.com/rex/install.sh" ] || exit 99
[ "${TEST_REX_DOWNLOAD_STATUS:-0}" -eq 0 ] || exit "$TEST_REX_DOWNLOAD_STATUS"
cat <<'INSTALLER'
printf 'rex-installer\\n' >> "$TEST_BOOTSTRAP_LOG"
[ "${TEST_REX_INSTALL_STATUS:-0}" -eq 0 ] || exit "$TEST_REX_INSTALL_STATUS"
mkdir -p "$HOME/.local/bin"
printf '#!/bin/sh\\nexit 0\\n' > "$HOME/.local/bin/rex"
chmod +x "$HOME/.local/bin/rex"
INSTALLER
'''
        scripts["tailscale"] = '''case "$*" in
  "status --json") exit "${TEST_TAILSCALE_READY_STATUS:-0}" ;;
  status) exit "${TEST_TAILSCALE_STATUS:-0}" ;;
  up) exit "${TEST_TAILSCALE_UP_STATUS:-0}" ;;
esac
exit 99
'''
        scripts["sudo"] = '''if [ "$1" = --preserve-env=HOME ]; then shift; fi
case "$1" in
  "${0%/*}/brew"|"${0%/*}/tailscale") exec "$@" ;;
  *) exit 99 ;;
esac
'''
        for name, script in scripts.items():
            tool = bin_dir / name
            tool.write_text(log_command + script)
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
                for relative in (".pi/agent", ".copilot"):
                    self.assertTrue((home / relative).is_dir())
                    self.assertFalse((home / relative).is_symlink())
                for package in ("kitty", "rex"):
                    self.assertEqual((home / ".config" / package).exists(), platform == "Darwin")
                self.assertEqual((home / ".agents").resolve(), ROOT / "agents/.agents")
                self.assertTrue((home / ".agents").is_symlink())
                self.assertFalse((home / ".pi/agent/skills").exists())
                for skill in (ROOT / "agents/.agents/skills").rglob("SKILL.md"):
                    relative = skill.relative_to(ROOT / "agents")
                    self.assertEqual((home / relative).resolve(), skill)
                for path in home.rglob("*"):
                    if path.is_symlink():
                        self.assertTrue(path.exists(), str(path))
                calls = Path(self.env["TEST_BOOTSTRAP_LOG"]).read_text()
                self.assertNotIn("curl ", calls)
                self.assertNotIn("uv tool install", calls)
                self.assertNotIn("tailscale up\n", calls)
                self.assertNotIn("open -a Tailscale\n", calls)
                if platform == "Linux":
                    self.assertIn("/brew services start tailscale\n", calls)
                    self.assertIn("tailscale status --json\n", calls)
                else:
                    self.assertNotIn("sudo ", calls)

    @unittest.skipUnless(STOW, "requires GNU Stow")
    def test_bootstrap_installs_missing_azure_cli_on_both_platforms(self):
        script = '''
command() {
  if [ "$*" = "-v az" ]; then return 1; fi
  builtin command "$@"
}
source "$1"
'''
        for platform in ("Linux", "Darwin"):
            with self.subTest(platform=platform):
                home = self.work / platform
                home.mkdir()
                self.env["HOME"] = str(home)
                self.mock_bootstrap_tools(platform)
                result = self.run_command([
                    "bash", "-c", script, "test", str(ROOT / "bootstrap.sh"),
                ])
                self.assert_success(result)
                calls = Path(self.env["TEST_BOOTSTRAP_LOG"]).read_text()
                self.assertEqual(calls.count("uv tool install -q azure-cli\n"), 1)

    @unittest.skipUnless(STOW, "requires GNU Stow")
    def test_bootstrap_installs_missing_rex_only_on_linux_and_can_repeat(self):
        script = '''
command() {
  if [ "$*" = "-v rex" ] && [ ! -x "$HOME/.local/bin/rex" ]; then return 1; fi
  builtin command "$@"
}
source "$1"
'''
        for platform in ("Linux", "Darwin"):
            with self.subTest(platform=platform):
                home = self.work / platform
                home.mkdir()
                self.env["HOME"] = str(home)
                self.mock_bootstrap_tools(platform)
                for _ in range(2):
                    result = self.run_command([
                        "bash", "-c", script, "test", str(ROOT / "bootstrap.sh"),
                    ])
                    self.assert_success(result)
                calls = Path(self.env["TEST_BOOTSTRAP_LOG"]).read_text()
                expected = 1 if platform == "Linux" else 0
                self.assertEqual(calls.count(
                    "curl -fsSL https://pkgs.superlogical.com/rex/install.sh\n",
                ), expected)
                self.assertEqual(calls.count("rex-installer\n"), expected)
                self.assertEqual((home / ".local/bin/rex").exists(), platform == "Linux")

    @unittest.skipUnless(STOW, "requires GNU Stow")
    def test_bootstrap_rex_installer_failures_stop_setup(self):
        script = '''
command() {
  if [ "$*" = "-v rex" ]; then return 1; fi
  builtin command "$@"
}
source "$1"
'''
        for variable in ("TEST_REX_DOWNLOAD_STATUS", "TEST_REX_INSTALL_STATUS"):
            with self.subTest(variable=variable):
                self.mock_bootstrap_tools("Linux")
                self.env[variable] = "1"
                result = self.run_command([
                    "bash", "-c", script, "test", str(ROOT / "bootstrap.sh"),
                ])
                del self.env[variable]
                self.assertNotEqual(result.returncode, 0)
                self.assertNotIn("Bootstrap complete", result.stdout)

    @unittest.skipUnless(STOW, "requires GNU Stow")
    def test_bootstrap_tailscale_connects_when_needed(self):
        self.env["TEST_TAILSCALE_STATUS"] = "1"
        for platform in ("Linux", "Darwin"):
            with self.subTest(platform=platform):
                home = self.work / platform
                home.mkdir()
                self.env["HOME"] = str(home)
                self.mock_bootstrap_tools(platform)
                result = self.run_command(["bash", str(ROOT / "bootstrap.sh")])
                self.assert_success(result)
                calls = Path(self.env["TEST_BOOTSTRAP_LOG"]).read_text()
                if platform == "Linux":
                    self.assertIn(
                        "sudo --preserve-env=HOME " + str(self.work / "bin/brew")
                        + " services start tailscale\n", calls,
                    )
                    self.assertIn(
                        "sudo " + str(self.work / "bin/tailscale") + " up\n", calls,
                    )
                    self.assertIn("tailscale up\n", calls)
                    self.assertNotIn("open -a Tailscale\n", calls)
                else:
                    self.assertIn("open -a Tailscale\n", calls)
                    self.assertNotIn("sudo ", calls)
                    self.assertNotIn("tailscale up\n", calls)

    @unittest.skipUnless(STOW, "requires GNU Stow")
    def test_bootstrap_tailscale_service_timeout(self):
        self.mock_bootstrap_tools("Linux")
        self.env["TEST_TAILSCALE_READY_STATUS"] = "1"
        result = self.run_command(["bash", str(ROOT / "bootstrap.sh")])
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Tailscale service did not become ready", result.stderr)
        calls = Path(self.env["TEST_BOOTSTRAP_LOG"]).read_text()
        self.assertEqual(calls.count("tailscale status --json\n"), 30)
        self.assertNotIn("tailscale up\n", calls)

    @unittest.skipUnless(STOW, "requires GNU Stow")
    def test_bootstrap_tailscale_connection_failure(self):
        self.mock_bootstrap_tools("Linux")
        self.env["TEST_TAILSCALE_STATUS"] = "1"
        self.env["TEST_TAILSCALE_UP_STATUS"] = "1"
        result = self.run_command(["bash", str(ROOT / "bootstrap.sh")])
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn("Bootstrap complete", result.stdout)

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
