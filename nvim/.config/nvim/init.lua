-- Main Neovim config. The look lives in lua/theme.lua and is shared with the
-- notes pad.
-- nvim-tree replaces netrw.
vim.g.loaded_netrw = 1
vim.g.loaded_netrwPlugin = 1

require("theme")

-- ---- Plugins (lazy.nvim) ----
-- lazy.nvim installs itself on first launch. Plugin specs live in
-- lua/plugins/, and lazy-lock.json pins their versions.
local lazypath = vim.fn.stdpath("data") .. "/lazy/lazy.nvim"
if not vim.uv.fs_stat(lazypath) then
  vim.fn.system({
    "git", "clone", "--filter=blob:none", "--branch=stable",
    "https://github.com/folke/lazy.nvim.git", lazypath,
  })
end
vim.opt.rtp:prepend(lazypath)
require("lazy").setup("plugins", { change_detection = { notify = false } })
require("lsp")

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
