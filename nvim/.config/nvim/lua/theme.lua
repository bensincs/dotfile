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

-- File tree (nvim-tree links its folder names to Directory).
hl("Directory", { ctermfg = 4 })
hl("NvimTreeRootFolder", { ctermfg = 3, cterm = { bold = true } })
hl("NvimTreeIndentMarker", { ctermfg = 8 })
hl("CursorLine", { cterm = { bold = true } })

-- Code (treesitter) in Solarized slots: 1 red, 2 green, 3 yellow, 4 blue,
-- 5 magenta, 6 cyan, 8 dim.
hl("@comment", { ctermfg = 8 })
hl("@keyword", { ctermfg = 2 })
hl("@string", { ctermfg = 6 })
hl("@number", { ctermfg = 5 })
hl("@boolean", { ctermfg = 5 })
hl("@constant", { ctermfg = 5 })
hl("@function", { ctermfg = 4 })
hl("@function.call", { ctermfg = 4 })
hl("@type", { ctermfg = 3 })
hl("@property", { ctermfg = 7 })
hl("@punctuation", { ctermfg = 8 })
hl("@operator", { ctermfg = 2 })

-- Diagnostics and completion popup.
hl("DiagnosticError", { ctermfg = 1 })
hl("DiagnosticWarn", { ctermfg = 3 })
hl("DiagnosticInfo", { ctermfg = 4 })
hl("DiagnosticHint", { ctermfg = 6 })
hl("DiagnosticUnderlineError", { cterm = { underline = true }, ctermfg = 1 })
hl("DiagnosticUnderlineWarn", { cterm = { underline = true }, ctermfg = 3 })
hl("Pmenu", { ctermfg = 7 })
hl("PmenuSel", { ctermbg = 8, ctermfg = 15 })
hl("FloatBorder", { ctermfg = 8 })
