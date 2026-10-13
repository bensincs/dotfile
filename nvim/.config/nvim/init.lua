-- Main Neovim config. The look lives in lua/theme.lua and is shared with the
-- notes pad.
require("theme")

local o = vim.opt
o.mouse = "a"
o.clipboard = "unnamedplus"
o.number = true
o.ignorecase = true
o.smartcase = true
o.splitright = true
o.splitbelow = true
o.undofile = true
o.scrolloff = 8
o.expandtab = true
o.shiftwidth = 2
o.tabstop = 2
o.shortmess:append("I")
