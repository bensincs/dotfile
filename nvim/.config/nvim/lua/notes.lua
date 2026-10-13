-- Live-synced scratch pad behavior, loaded only by the `n` zsh function:
--   nvim -c 'lua require("notes")' <file>
-- Every instance autosaves on each keystroke and reloads when the file changes,
-- so any number of terminals or herdr panes stay in sync.

local o = vim.opt
o.autoread = true
o.swapfile = false
o.backup = false
o.writebackup = false
o.backupcopy = "yes" -- write in place so file watchers keep working
o.wrap = true
o.linebreak = true

-- ---- Header ----
-- A bar above the text; it is not part of the file. Set for this window only,
-- and cleared in the file tree, which would otherwise inherit it from a split.
vim.wo.winbar = " Notes"
vim.api.nvim_create_autocmd("FileType", {
  pattern = "NvimTree",
  callback = function() vim.wo.winbar = "" end,
})
vim.api.nvim_set_hl(0, "WinBar", { ctermfg = 4, cterm = { bold = true } })
vim.api.nvim_set_hl(0, "WinBarNC", { ctermfg = 8, cterm = { bold = true } })

-- ---- Autosave ----
local group = vim.api.nvim_create_augroup("notes", { clear = true })
vim.api.nvim_create_autocmd({ "TextChanged", "TextChangedI", "InsertLeave", "FocusLost" }, {
  group = group,
  callback = function()
    if vim.bo.modified and vim.bo.buftype == "" and vim.api.nvim_buf_get_name(0) ~= "" then
      vim.cmd("silent! write")
    end
  end,
})

-- ---- Live reload ----
-- Watch the directory, not the file: iCloud and some writers replace the file,
-- which would leave a file-level watcher pointing at a dead inode.
local function watch(file)
  local name = vim.fs.basename(file)
  local handle = vim.uv.new_fs_event()
  handle:start(vim.fs.dirname(file), {}, vim.schedule_wrap(function(err, changed)
    if err or (changed and changed ~= name) then return end
    for _, buf in ipairs(vim.api.nvim_list_bufs()) do
      if vim.api.nvim_buf_get_name(buf) == file then
        vim.cmd("silent! checktime " .. buf)
      end
    end
  end))
end

vim.api.nvim_create_autocmd("VimEnter", {
  group = group,
  callback = function()
    local arg = vim.fn.argv(0)
    if arg ~= "" then
      watch(vim.fn.fnamemodify(arg, ":p"))
      vim.cmd("normal! G$")
      vim.cmd("startinsert!") -- start typing at the end of the file
    end
  end,
})

-- Ctrl+Q closes the pad.
vim.keymap.set({ "n", "i" }, "<C-q>", "<Cmd>qa<CR>")
