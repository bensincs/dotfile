-- LSP behavior: diagnostics, completion, and keys. Servers come from
-- lua/plugins/lsp.lua. Neovim already maps K (hover), grn (rename),
-- gra (code action), and grr (references).
vim.opt.winborder = "rounded"
vim.opt.completeopt = { "menu", "menuone", "noinsert", "popup" }

vim.diagnostic.config({
  virtual_text = true,
  severity_sort = true,
  float = { border = "rounded" },
})

vim.api.nvim_create_autocmd("LspAttach", {
  callback = function(args)
    local client = vim.lsp.get_client_by_id(args.data.client_id)
    if client and client:supports_method("textDocument/completion") then
      vim.lsp.completion.enable(true, client.id, args.buf, { autotrigger = true })
    end
    vim.keymap.set("n", "gd", vim.lsp.buf.definition, { buffer = args.buf, desc = "Go to definition" })
  end,
})
