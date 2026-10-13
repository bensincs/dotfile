-- Language servers are installed by mason from the list below and enabled
-- automatically. TypeScript and YAML come from Homebrew (see nvim-lspconfig).
-- The notes pad (NOTES_PAD=1) skips them: no completion popups or diagnostics
-- while dumping notes.
return {
  {
    "neovim/nvim-lspconfig",
    event = { "BufReadPre", "BufNewFile" },
    config = function()
      -- Installed by Homebrew (Brewfile), not mason: the npm registry mason
      -- uses is a corporate proxy that lags behind the versions it expects.
      -- TypeScript uses tsc 7's built-in language server.
      if vim.env.NOTES_PAD == nil then
        vim.lsp.enable({ "tsc", "yamlls" })
      end
    end,
  },
  { "mason-org/mason.nvim", opts = {} },
  {
    "mason-org/mason-lspconfig.nvim",
    event = { "BufReadPre", "BufNewFile" },
    dependencies = { "mason-org/mason.nvim", "neovim/nvim-lspconfig" },
    opts = {
      ensure_installed = {
        "bashls", "gopls", "jsonls", "lua_ls", "marksman", "pyright",
        "rust_analyzer", "terraformls",
      },
      automatic_enable = vim.env.NOTES_PAD == nil,
    },
  },
}
