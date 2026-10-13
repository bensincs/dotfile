-- Shared look for every Neovim setup (main config and the notes pad).
-- Use the terminal's 16-color palette (Solarized Dark in kitty) instead of
-- Neovim's own RGB colors, so Neovim matches kitty, herdr, and delta,
-- including kitty's background opacity and blur.
local o = vim.opt
o.termguicolors = false
o.background = "dark"
o.fillchars:append({ eob = " " }) -- hide the ~ markers after the last line

-- Palette slots: 2 green, 3 yellow, 4 blue, 6 cyan, 8 dim (Solarized base01).
local function hl(group, spec) vim.api.nvim_set_hl(0, group, spec) end
hl("Comment", { ctermfg = 8 })
hl("Title", { ctermfg = 4, cterm = { bold = true } })
hl("Visual", { ctermbg = 8, ctermfg = 15 })
hl("Search", { ctermbg = 3, ctermfg = 0 })
hl("NonText", { ctermfg = 8 })
hl("@markup.heading", { ctermfg = 4, cterm = { bold = true } })
hl("@markup.strong", { cterm = { bold = true } })
hl("@markup.italic", { cterm = { italic = true } })
hl("@markup.link", { ctermfg = 6 })
hl("@markup.link.url", { ctermfg = 8, cterm = { underline = true } })
hl("@markup.raw", { ctermfg = 2 })
hl("@markup.list", { ctermfg = 3 })
hl("markdownH1", { ctermfg = 4, cterm = { bold = true } })
hl("markdownH2", { ctermfg = 4, cterm = { bold = true } })
hl("markdownH3", { ctermfg = 4, cterm = { bold = true } })
hl("markdownCode", { ctermfg = 2 })
hl("markdownListMarker", { ctermfg = 3 })
