return {
  "nvim-tree/nvim-tree.lua",
  dependencies = { "nvim-tree/nvim-web-devicons" }, -- file icons (Nerd Font)
  keys = { { "<C-e>", "<Cmd>NvimTreeToggle<CR>", desc = "Toggle file tree" } },
  opts = {
    view = { width = 32 },
    renderer = { indent_markers = { enable = true } },
    update_focused_file = { enable = true }, -- highlight the current file
    filters = { dotfiles = false },
    on_attach = function(bufnr)
      local api = require("nvim-tree.api")
      api.config.mappings.default_on_attach(bufnr)

      -- nvim-tree maps <C-e> to "open in place", which replaces the tree.
      -- Make it close the tree instead, matching the key that opened it.
      vim.keymap.set("n", "<C-e>", api.tree.close, { buffer = bufnr, desc = "Close file tree" })

      -- Single click opens files and expands/collapses folders.
      vim.keymap.set("n", "<LeftMouse>", function()
        local mouse = vim.fn.getmousepos()
        if mouse.winid ~= vim.api.nvim_get_current_win() then
          vim.api.nvim_set_current_win(mouse.winid)
        end
        vim.api.nvim_win_set_cursor(mouse.winid, { mouse.line, 0 })
        api.node.open.edit()
      end, { buffer = bufnr, desc = "Open on click" })
    end,
  },
}
