// An Azure architecture explainer: big text, a diagram that builds up with packets flowing, and a
// terminal. Self-contained (no app, no VS Code). From any scratch folder:
//
//   node <skill-dir>/scripts/narrate.mjs <skill-dir>/examples/azure-architecture.demo.mjs --stills --out ./narrated-examples
//   node <skill-dir>/scripts/narrate.mjs <skill-dir>/examples/azure-architecture.demo.mjs --draft  --out ./narrated-examples
export default {
  name: 'azure-architecture',
  transition: 'fade',
  pronounce: { azd: 'A Z D', 'Cosmos DB': 'Cosmos D B' },
  // Scripted output only, so the folder doesn't matter: give the window a project's name.
  terminal: { title: 'zsh — ~/chat-with-your-data', prompt: '\x1b[36mchat-with-your-data\x1b[0m \x1b[32m❯\x1b[0m ' },
  diagram: {
    title: 'Chat with your data',
    subtitle: 'Reference architecture, private by default',
    nodes: {
      users: { icon: 'users', label: 'Users', at: [0, 1] },
      entra: { icon: 'entra', label: 'Microsoft Entra ID', at: [0, 2.15] },
      fd: { icon: 'front-door', label: 'Front Door', sub: 'WAF policy', at: [1.05, 1] },
      app: { icon: 'container-apps', label: 'Chat API', sub: 'Container Apps', at: [2.25, 1] },
      openai: { icon: 'openai', label: 'Azure OpenAI', sub: 'gpt-4o', at: [3.7, 0.15] },
      search: { icon: 'ai-search', label: 'AI Search', sub: 'your documents', at: [3.7, 1] },
      cosmos: { icon: 'cosmos-db', label: 'Cosmos DB', sub: 'chat history', at: [3.7, 1.85] },
      insights: { icon: 'app-insights', label: 'Application Insights', at: [1.05, 2.15] },
    },
    groups: {
      sub: { kind: 'subscription', label: 'Contoso AI', contains: ['rg'] },
      rg: { kind: 'resource-group', label: 'rg-chat-prod', contains: ['fd', 'vnet', 'insights'] },
      vnet: { kind: 'vnet', label: 'vnet-chat 10.20.0.0/16', contains: ['app', 'pe'] },
      pe: { kind: 'subnet', label: 'snet-private-endpoints', contains: ['openai', 'search', 'cosmos'] },
    },
    edges: [
      ['users', 'entra', 'sign in'],
      ['users', 'fd', 'HTTPS'],
      ['fd', 'app', 'Private Link'],
      ['app', 'openai', 'completions'],
      ['app', 'search', 'retrieve'],
      ['app', 'cosmos', 'history'],
      { from: 'app', to: 'insights', label: 'telemetry', style: 'dashed' },
    ],
  },
  steps: [
    { chapter: 'hook', say: 'Here is how to let people chat with your own data, without exposing any of it.', text: 'Chat with your data. *Privately.*', caption: false },

    { chapter: 'architecture', say: 'Users sign in with Entra ID, and reach the app through Azure Front Door.', diagram: ['users', 'entra', 'users->entra', 'fd', 'users->fd'] },
    { say: 'The chat API runs in Azure Container Apps, inside its own virtual network.', diagram: ['fd->app'] },
    { say: 'It finds answers in your documents with AI Search, writes them with Azure OpenAI, and keeps the history in Cosmos DB.', diagram: ['app->search', 'app->openai', 'app->cosmos'] },
    { say: 'All three sit behind private endpoints. None of them can be reached from the internet.', diagram: {
      focus: ['openai', 'search', 'cosmos'], mark: { openai: 'ok', search: 'ok', cosmos: 'ok' }, note: [{ at: 'search', text: 'Public access disabled' }],
    } },
    { say: 'Follow one question: in through Front Door, to the API, which searches your documents, then asks the model.', diagram: { focus: 'all', flow: ['users->fd->app->search', 'app->openai'] } },
    { say: 'And every call is traced in Application Insights.', diagram: 'all' },

    { chapter: 'deploy', say: 'Deploying the whole thing takes one command.', terminal: {
      cmd: 'azd up',
      output: [
        '\x1b[1mProvisioning Azure resources\x1b[0m (azd provision)',
        '  \x1b[32m(✓) Done:\x1b[0m Resource group: rg-chat-prod',
        '  \x1b[32m(✓) Done:\x1b[0m Virtual network: vnet-chat',
        '  \x1b[32m(✓) Done:\x1b[0m Azure OpenAI: oai-chat-prod',
        '  \x1b[32m(✓) Done:\x1b[0m AI Search: srch-chat-prod',
        '  \x1b[32m(✓) Done:\x1b[0m Cosmos DB: cosmos-chat-prod',
        '  \x1b[32m(✓) Done:\x1b[0m Container App: ca-chat-api',
        '',
        '\x1b[1mDeploying services\x1b[0m (azd deploy)',
        '  \x1b[32m(✓) Done:\x1b[0m Deploying service api',
        '  - Endpoint: \x1b[36mhttps://chat.contoso.example\x1b[0m',
        '',
        '\x1b[32mSUCCESS:\x1b[0m Your application was provisioned and deployed to Azure in 9 minutes 12 seconds.',
      ].join('\n'),
    } },

    { chapter: 'takeaway', say: 'No public endpoints on your data, and one command to ship it.', text: { stats: [{ value: '0', label: 'public endpoints on your data' }, { value: '1', label: 'command to deploy', accent: true }] }, caption: false },
  ],
};
