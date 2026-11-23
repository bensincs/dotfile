-- Appearance lives in Rex's client settings, not in init.lua.
-- Run "Apply Kitty Style" from the command palette after reloading this file.
local config_home = os.getenv("XDG_CONFIG_HOME") or (os.getenv("HOME") .. "/.config")

rex.action{
  name = "kitty_style",
  title = "Apply Kitty Style",
  description = "Match the font, colors, padding, and cursor in the Kitty dotfiles.",
  run = function()
    rex.client.queue("client.setting.interface.appearance.scheme", { value = "dark" })
    rex.client.queue("client.theme.import", {
      path = config_home .. "/rex/themes/Kitty Solarized Dark",
    })
    rex.client.queue("client.setting.interface.appearance.tint", { value = true })
    rex.client.queue("client.setting.interface.toolbar.layout", { value = "left" })
    rex.client.queue("client.setting.interface.pane_padding.horizontal", { value = 8 })
    rex.client.queue("client.setting.interface.pane_padding.vertical", { value = 8 })
    rex.client.queue("client.setting.terminal.typography.font", {
      value = "JetBrainsMono Nerd Font Mono",
    })
    rex.client.queue("client.setting.terminal.typography.size", { value = 13 })
    rex.client.queue("client.setting.terminal.cursor.style", { value = "bar" })
    rex.client.queue("client.setting.terminal.cursor.blink", { value = "off" })
    rex.client.queue("client.setting.terminal.colors.contrast", { value = false })
    rex.client.queue("client.setting.terminal.colors.palette", { value = false })
    rex.client.queue("client.setting.terminal.colors.display_p3", { value = false })
    rex.client.queue("client.setting.themes.dark.extended_palette", { value = false })
    rex.client.queue("client.setting.terminal.selection.copy_on_select", { value = true })
  end,
}

-- Match Kitty's shell editing, clipboard, and font-size shortcuts.
rex.bind("cmd+left", "pane.send_key", { key = "ctrl+a" })
rex.bind("cmd+right", "pane.send_key", { key = "ctrl+e" })
rex.bind("alt+left", "pane.send_key", { key = "alt+b" })
rex.bind("alt+right", "pane.send_key", { key = "alt+f" })
rex.bind("cmd+backspace", "pane.send_key", { key = "ctrl+u" })
rex.bind("cmd+c", "pane.copy")
rex.bind("cmd+v", "pane.paste")
rex.bind("cmd+shift+=", "client.font.increase")
rex.bind("cmd+-", "client.font.decrease")

-- Ctrl+A leader: split right, split below, open a tab, or close a pane.
-- Ctrl+A, N opens the notes pad as a popup; Ctrl+A, Ctrl+N appends the clipboard first.
-- Quit the pad with Ctrl+Q to close the popup.
local notes_script = os.getenv("HOME") .. "/.config/zsh/notes.sh"

rex.action{
  name = "notes",
  title = "Open Notes Pad",
  description = "Open the live-synced notes pad in a floating pane.",
  args = { clip = "boolean?" },
  run = function(ctx, args)
    local command = { "bash", notes_script }
    if args and args.clip then table.insert(command, "--clip") end
    local result, err = rex.session.new_layer{
      session_id = ctx.session_id,
      bounds = { 0.1, 0.1, 0.8, 0.8 },
      layout = rex.layout.block{
        flavor = "com.superlogical.terminal.shell",
        options = { command = command },
      },
      focus = true,
    }
    if not result then error(err) end
    return result
  end,
}

rex.bind("ctrl+a>v", "pane.split", { direction = "right" })
rex.bind("ctrl+a>h", "pane.split", { direction = "down" })
rex.bind("ctrl+a>t", "client.tab.new")
rex.bind("ctrl+a>x", "pane.close")
rex.bind("ctrl+a>p", "client.palette.toggle")
rex.bind("ctrl+a>n", "notes")
rex.bind("ctrl+a>ctrl+n", "notes", { clip = true })
for _, direction in ipairs({ "left", "right", "up", "down" }) do
  rex.bind("ctrl+a>" .. direction, "pane.focus", { direction = direction })
end
rex.bind("ctrl+a>ctrl+a", "pane.send_key", { key = "ctrl+a" })

-- Send the same explicit CSI-u Super+digit bytes as Kitty.
-- These replace Rex's default tab-selection and font-reset shortcuts.
for digit = 0, 9 do
  local sequence = string.format("\27[%d;9u", 48 + digit)
  rex.bind("cmd+" .. digit, function(ctx)
    local result, err = rex.call("com.superlogical.terminal.write", {
      session_id = ctx.session_id,
      block_id = ctx.block_id,
      args = { data = sequence },
    })
    if not result then error(err) end
    return true
  end)
end

-- Swallow Cmd pane/tab shortcuts rather than forwarding them to terminal apps.
-- Keep clipboard, shell editing, font sizing, and Pi model shortcuts available.
for _, key in ipairs({
  "cmd+d", "cmd+shift+d", "cmd+t", "cmd+w", "cmd+alt+w",
  "cmd+[", "cmd+]", "cmd+shift+[", "cmd+shift+]",
  "cmd+shift+left", "cmd+shift+right", "cmd+shift+up", "cmd+shift+down",
  "cmd+alt+left", "cmd+alt+right", "cmd+alt+up", "cmd+alt+down",
  "cmd+enter", "cmd+shift+enter", "ctrl+shift+enter",
}) do
  rex.bind(key, function() return true end)
end
