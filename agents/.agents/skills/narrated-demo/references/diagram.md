# Diagram scenes

Clean architecture diagrams with Microsoft's official Azure icons. You declare the diagram once; each step reveals parts of it as the narrator speaks, sends packets along request paths, zooms into an area, highlights, marks status and adds notes. The layout is a grid, so diagrams come out tidy without placing pixels.

Use diagrams for **precise structure**: Azure architectures, data flows, network boundaries, before and after. Use the chalkboard for informal sketches, and clay for stories.

```js
export default {
  diagram: {
    title: 'Contoso web app',
    subtitle: 'Production, West Europe',
    nodes: {
      users: { icon: 'users', label: 'Users', at: [0, 1] },
      fd: { icon: 'front-door', label: 'Front Door', sub: 'WAF policy', at: [1, 1] },
      app: { icon: 'app-service', label: 'App Service', sub: 'P1v3', at: [2, 1] },
      sql: { icon: 'sql-database', label: 'Azure SQL', at: [3.4, 0.4] },
      kv: { icon: 'key-vault', label: 'Key Vault', at: [3.4, 1.6] },
      ai: { icon: 'app-insights', label: 'Application Insights', at: [2, 2.6] },
    },
    groups: {
      sub: { kind: 'subscription', label: 'Contoso Production', contains: ['rg'] },
      rg: { kind: 'resource-group', label: 'rg-web-prod', contains: ['fd', 'vnet', 'ai'] },
      vnet: { kind: 'vnet', label: 'vnet-web 10.0.0.0/16', contains: ['app', 'pe'] },
      pe: { kind: 'subnet', label: 'snet-private-endpoints', contains: ['sql', 'kv'] },
    },
    edges: [
      ['users', 'fd', 'HTTPS'],
      ['fd', 'app', 'Private Link'],
      ['app', 'sql', 'Private endpoint'],
      ['app', 'kv', 'Managed identity'],
      { from: 'app', to: 'ai', label: 'telemetry', style: 'dashed' },
    ],
  },
  steps: [
    { say: 'Customers reach the app through Azure Front Door.', diagram: ['users', 'fd', 'users->fd'] },
    { say: 'Front Door connects privately to App Service, inside its own network.', diagram: ['fd->app'] },
    { say: 'Here is the whole design.', diagram: 'all' },
    { say: 'Follow one request, from the user to the database.', diagram: { flow: 'users->fd->app->sql' } },
    { say: 'The data tier has no public endpoint.', diagram: { focus: ['app', 'sql', 'kv'], note: [{ at: 'sql', text: 'No public endpoint' }] } },
    { say: 'Secrets come from Key Vault, with a managed identity.', diagram: { mark: { kv: 'ok' }, highlight: 'kv' } },
    { say: 'Private, secure and observable.', diagram: { focus: 'all' } },
  ],
};
```

## Layout

- **Nodes sit on a grid:** `at: [col, row]`. Columns are about 230 units apart and rows about 170. Fractions are fine (`[3.4, 0.4]`) for nudging. Lay data left to right: users on the left, data stores on the right.
- **Groups wrap what they contain:** nodes or other groups, nested as deep as you like (subscription › resource group › VNet › subnet). A thing can be in one group directly; nest groups rather than overlapping them.
- **Edges route themselves** at right angles between node sides, spreading out when several share a side. Arrows point from `from` to `to`.
- **The camera frames everything**, leaving room for the title and captions, and zooms in at most 2× for a focus.
- **Layout problems are reported:** nodes overlapping, a node crossing a group it isn't in, groups partly overlapping. They show in `--stills`, in the capture log and as review flags. Fix them by moving nodes (`at`), or by adding a node to the group it sits in.

## Nodes

| Field | Does |
|---|---|
| `icon` | An Azure icon by name: `'app-service'`, `'key-vault'`, `'front-door'`, `'aks'`, `'cosmos-db'`, `'openai'`… Defaults to the node's id. `false` for a plain box. |
| `label` | Name under the icon (defaults to the id); wraps at about 18 characters |
| `sub` | A smaller grey line under the label: a SKU, a size, a count |
| `at` | `[col, row]` |

**Finding icons:** `node scripts/narrate.mjs --icons <words>` searches all ~720 Azure icons, e.g. `--icons event`, `--icons private`. Common names and abbreviations work too: `aks`, `acr`, `apim`, `appgw`, `waf`, `nsg`, `pe`, `vnet`, `law`, `appinsights`, `entra`, `openai`, `foundry`, `ai-search`, `redis`, `postgres`, `functions`, `container-apps`, `logic-app`, `service-bus`, `event-hub`, `event-grid`. Spec checks suggest close matches for a name that isn't found.

**Beyond Azure:** `internet`, `onprem`, `server`, `laptop`, `database` and `code` (a repository) are plain built-in icons; `users`, `browser` and `mobile` come from the Azure set.

Setup downloads the icons from Microsoft (https://learn.microsoft.com/azure/architecture/icons/). Microsoft permits their use in architecture diagrams, training material and documentation. The set has no plain Entra ID icon (that is in Microsoft's separate Entra set); `entra` shows the Entra diamond from Entra Domain Services.

## Groups

`{ kind, label, contains: [ids] }`. Kinds draw like Azure documentation:

| `kind` | Looks like |
|---|---|
| `subscription` | Gold dashed frame with a key icon |
| `management-group` | Grey dashed frame |
| `resource-group` | Grey dashed frame with the resource-group cube |
| `region` | Thin solid frame |
| `vnet` | Blue frame, light blue tint, the VNet icon |
| `subnet` | Blue dashed frame inside a VNet |
| `zone` | Thin dotted frame, for availability zones |
| `cluster` | Purple frame, for AKS and similar |
| `on-premises` | Grey dashed frame with a building icon |
| `group` | A plain frame (the default) |

`icon` on a group overrides its kind's icon (`false` for none).

## Edges

`['from', 'to', 'label']`, or `{ from, to, label, style: 'dashed', both: true, fromSide, toSide }`. An edge's id is `'from->to'`; steps refer to it that way. `both: true` draws arrowheads at both ends; `fromSide` and `toSide` (`left`, `right`, `top`, `bottom`) override the automatic sides.

## Steps

`diagram` on a step is an action:

| Form | Does |
|---|---|
| `'all'` | Builds up everything not yet shown: groups draw their frames, nodes pop in, edges draw along their paths |
| `['users', 'fd', 'users->fd']` | Shows those things (and anything they need: a node's groups, an edge's ends) |
| `{ show, hide }` | Shows or fades out things |
| `{ flow: 'users->fd->app->sql' }` | Sends glowing packets along a path; its edges light up in the accent colour. `flow: ['a->b', 'c->d']` for several; `flow: { path, color, packets }` to style them. Each hop must be an edge (either direction). |
| `{ focus: ['app', 'sql'] }` | Zooms the camera onto those things and dims the rest. Stays until `focus: 'all'`. |
| `{ highlight: 'kv' }` | A pulsing ring around a node |
| `{ mark: { kv: 'ok', sql: 'error', app: '3x' } }` | A badge on the icon: `ok` (green tick), `error` (red cross), `warn` (amber), or short text. `null` removes it. Stays until changed. |
| `{ note: [{ at: 'sql', text: 'No public endpoint', side: 'right' }] }` | A callout beside a node or group (`right`, `left`, `top`, `bottom`); clears at the next step unless `keepNotes: true` |
| `{ title: 'Phase 2' }` | Changes the title |
| `{ stage: { nodes, groups, edges, title }, show: 'all' }` | A new diagram from this step on |

Combine them in one step: `{ show: ['kv'], focus: ['app', 'kv'], note: [...] }`. Everything shares the line's time, and the diagram keeps its state between steps, even with other scenes in between.

## Spec options

```js
diagram: {
  theme: 'light',   // or 'dark'
  title, subtitle, nodes, groups, edges,
}
```

## Writing diagram steps

- **Build it in the order you explain it.** One idea a step: the entry point, then the app, then the data. Show `'all'` once the parts are named.
- **Say what moves.** A `flow` step should name the hops: "from the user, through Front Door, to the app".
- **Focus for detail, then zoom back out.** Focus on two to four things; end with `focus: 'all'`.
- **Labels short, details in `sub`:** "App Service" with "P1v3, 3 instances" under it.
- **Preview layout first:** `--stills` renders every diagram step in seconds, with layout problems listed.

## Review

- Every part the line names is on screen and readable.
- No layout problems flagged; nothing overlaps; edges don't run through nodes.
- Focus shots keep notes in frame.
