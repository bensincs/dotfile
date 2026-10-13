return {
  "nvim-treesitter/nvim-treesitter",
  branch = "main",
  lazy = false, -- the plugin does not support lazy-loading
  build = ":TSUpdate",
  config = function()
    -- Parsers are compiled with the tree-sitter CLI (Brewfile) on first launch.
    require("nvim-treesitter").install({
      "bash", "c", "css", "diff", "dockerfile", "go", "gomod", "hcl", "html",
      "javascript", "json", "lua", "markdown", "markdown_inline", "python",
      "query", "regex", "rust", "terraform", "toml", "tsx", "typescript",
      "vim", "vimdoc", "yaml",
    })

    -- Turn on treesitter highlighting wherever a parser exists.
    vim.api.nvim_create_autocmd("FileType", {
      callback = function() pcall(vim.treesitter.start) end,
    })
  end,
}
