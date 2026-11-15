// Azure architecture icons: Microsoft's official set, downloaded by setup.sh into the runtime, plus
// a few plain built-in icons for things outside Azure (internet, on-premises, servers, laptops).
// Microsoft permits these icons in architecture diagrams, training material and documentation.
import fs from 'node:fs';
import path from 'node:path';
import { RUNTIME, SKILL, die } from './common.mjs';

export const ICON_DIR = path.join(RUNTIME, 'azure-icons');

// Plain, neutral icons for things that aren't Azure services. 64 x 64, drawn to sit beside the set.
const stroke = 'fill="none" stroke="#50596a" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"';
const BUILT_IN = {
  internet: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="24" fill="#e8f1fb" stroke="#0078d4" stroke-width="3"/><path d="M8 32h48M32 8c-8 8-8 40 0 48M32 8c8 8 8 40 0 48M13 19h38M13 45h38" fill="none" stroke="#0078d4" stroke-width="2.5"/></svg>`,
  onprem: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><path d="M10 56V22l22-12 22 12v34z" fill="#f3f2f1"/><path d="M10 56V22l22-12 22 12v34zM4 56h56" ${stroke}/><path d="M20 30h8v8h-8zM36 30h8v8h-8zM28 56V44h8v12" ${stroke}/></svg>`,
  server: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect x="12" y="8" width="40" height="48" rx="5" fill="#f3f2f1" stroke="#50596a" stroke-width="3"/><path d="M12 24h40M12 40h40" ${stroke}/><circle cx="44" cy="16" r="2.5" fill="#57a300"/><circle cx="44" cy="32" r="2.5" fill="#57a300"/><circle cx="44" cy="48" r="2.5" fill="#57a300"/></svg>`,
  laptop: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect x="12" y="14" width="40" height="28" rx="3" fill="#e8f1fb" stroke="#50596a" stroke-width="3"/><path d="M4 50h56l-4-8H8z" fill="#f3f2f1" stroke="#50596a" stroke-width="3" stroke-linejoin="round"/></svg>`,
  database: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><path d="M12 14v36c0 4.4 9 8 20 8s20-3.6 20-8V14" fill="#f3f2f1"/><ellipse cx="32" cy="14" rx="20" ry="8" fill="#e8f1fb" stroke="#50596a" stroke-width="3"/><path d="M12 14v36c0 4.4 9 8 20 8s20-3.6 20-8V14M12 32c0 4.4 9 8 20 8s20-3.6 20-8" ${stroke}/></svg>`,
  code: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect x="6" y="10" width="52" height="44" rx="5" fill="#f3f2f1" stroke="#50596a" stroke-width="3"/><path d="M24 24l-8 8 8 8M40 24l8 8-8 8M35 20l-6 24" ${stroke}/></svg>`,
};

// Common names people write, mapped to the icon set's names.
const ALIASES = {
  'app-service': 'app-services', 'web-app': 'app-services', webapp: 'app-services', 'app-service-plan': 'app-service-plans',
  aks: 'kubernetes-services', kubernetes: 'kubernetes-services', 'container-app': 'worker-container-app', 'container-apps': 'worker-container-app',
  'container-apps-environment': 'container-apps-environments', acr: 'container-registries', 'container-registry': 'container-registries',
  functions: 'function-apps', function: 'function-apps', 'function-app': 'function-apps', vm: 'virtual-machine', vms: 'virtual-machine',
  vmss: 'vm-scale-sets', 'static-web-app': 'static-apps', 'static-web-apps': 'static-apps', 'logic-app': 'logic-apps',
  sql: 'sql-database', 'azure-sql': 'azure-sql', 'sql-db': 'sql-database', cosmos: 'azure-cosmos-db', 'cosmos-db': 'azure-cosmos-db', cosmosdb: 'azure-cosmos-db',
  postgres: 'azure-database-postgresql-server', postgresql: 'azure-database-postgresql-server', mysql: 'azure-database-mysql-server',
  redis: 'cache-redis', 'redis-cache': 'cache-redis', storage: 'storage-accounts', 'storage-account': 'storage-accounts', blob: 'storage-accounts',
  'data-lake': 'data-lake-storage-gen1', 'key-vault': 'key-vaults', keyvault: 'key-vaults', kv: 'key-vaults',
  vnet: 'virtual-networks', 'virtual-network': 'virtual-networks', 'private-endpoint': 'private-endpoints', pe: 'private-endpoints',
  'private-link': 'private-link', nsg: 'network-security-groups', 'nat-gateway': 'nat', 'public-ip': 'public-ip-addresses',
  'load-balancer': 'load-balancers', lb: 'load-balancers', 'app-gateway': 'application-gateways', 'application-gateway': 'application-gateways',
  appgw: 'application-gateways', waf: 'web-application-firewall-policies(waf)', firewall: 'firewalls', 'azure-firewall': 'firewalls',
  'front-door': 'front-door-and-cdn-profiles', frontdoor: 'front-door-and-cdn-profiles', afd: 'front-door-and-cdn-profiles', cdn: 'cdn-profiles',
  'traffic-manager': 'traffic-manager-profiles', dns: 'dns-zones', 'private-dns': 'dns-zones', bastion: 'bastions', 'vpn-gateway': 'virtual-network-gateways',
  'vnet-gateway': 'virtual-network-gateways', expressroute: 'expressroute-circuits', apim: 'api-management-services', 'api-management': 'api-management-services',
  'service-bus': 'azure-service-bus', servicebus: 'azure-service-bus', 'event-hub': 'event-hubs', eventhub: 'event-hubs', 'event-grid': 'event-grid-topics',
  openai: 'azure-openai', 'azure-openai': 'azure-openai', 'ai-foundry': 'ai-foundry', foundry: 'ai-foundry', 'ai-search': 'cognitive-search',
  'cognitive-search': 'cognitive-search', search: 'cognitive-search', 'ai-services': 'cognitive-services', 'cognitive-services': 'cognitive-services',
  'machine-learning': 'machine-learning', aml: 'machine-learning', 'app-insights': 'application-insights', appinsights: 'application-insights',
  'log-analytics': 'log-analytics-workspaces', law: 'log-analytics-workspaces', monitor: 'monitor', 'azure-monitor': 'monitor',
  // The set has no plain Entra ID icon (that is in Microsoft's separate Entra set); this shows its diamond.
  entra: 'entra-domain-services', 'entra-id': 'entra-domain-services', aad: 'entra-domain-services', 'managed-identity': 'managed-identities', identity: 'managed-identities',
  user: 'users', users: 'users', people: 'users', group: 'groups', subscription: 'subscriptions', 'resource-group': 'resource-groups', rg: 'resource-groups',
  'management-group': 'management-groups', policy: 'policy', defender: 'microsoft-defender-for-cloud', sentinel: 'azure-sentinel',
  devops: 'azure-devops', 'azure-devops': 'azure-devops', phone: 'mobile', browser: 'browser', web: 'browser', 'on-premises': 'onprem', 'on-prem': 'onprem',
  datacenter: 'onprem', globe: 'internet', www: 'internet', computer: 'laptop', pc: 'laptop', db: 'database', github: 'code', git: 'code', repo: 'code',
  arc: 'azure-arc', 'azure-arc': 'azure-arc', 'recovery-vault': 'recovery-services-vaults', backup: 'backup-vault', 'data-factory': 'data-factories', adf: 'data-factories',
  synapse: 'azure-synapse-analytics', databricks: 'azure-databricks', 'power-bi': 'power-bi-embedded', signalr: 'signalr',
  grafana: 'azure-managed-grafana', 'notification-hub': 'notification-hubs', 'communication-services': 'azure-communication-services',
};

const norm = s => String(s).toLowerCase().replace(/^azure[- ]/, '').replace(/[^a-z0-9()]+/g, '-').replace(/^-|-$/g, '');

let index = null;
/** name -> file, built once from the downloaded set. Earlier categories win duplicate names. */
function load() {
  if (index) return index;
  index = new Map();
  const root = path.join(ICON_DIR, 'Azure_Public_Service_Icons', 'Icons');
  if (!fs.existsSync(root)) die(`The Azure icons are missing. Run: ${SKILL}/scripts/setup.sh --runtime-only`);
  for (const category of fs.readdirSync(root).sort()) {
    const dir = path.join(root, category);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.svg'))) {
      const name = file.replace(/^\d+-icon-service-/, '').replace(/\.svg$/, '');
      for (const key of new Set([norm(name), norm(name).replace(/^azure-/, '')])) if (!index.has(key)) index.set(key, { name, category, file: path.join(dir, file) });
    }
  }
  return index;
}

/** Finds an icon by any reasonable name: 'app-service', 'App Services', 'key vault', 'internet'. */
export function findIcon(query) {
  const q = norm(query);
  if (BUILT_IN[q]) return { name: q, category: 'built-in', svg: BUILT_IN[q] };
  const alias = ALIASES[q] ?? ALIASES[q.replace(/s$/, '')];
  if (alias && BUILT_IN[alias]) return { name: alias, category: 'built-in', svg: BUILT_IN[alias] };
  const idx = load();
  for (const key of [alias, q, `${q}s`, q.replace(/s$/, ''), `azure-${q}`, alias && `azure-${alias}`].filter(Boolean)) {
    if (idx.has(norm(key))) return idx.get(norm(key));
  }
  return null;
}

/** Icon names containing every word of the query, for --icons and for suggestions in errors. */
export function searchIcons(query = '') {
  const words = norm(query).split('-').filter(Boolean);
  const names = [...new Set([...load().values()].map(v => `${norm(v.name)}  (${v.category})`)), ...Object.keys(BUILT_IN).map(k => `${k}  (built-in)`)];
  return names.filter(n => words.every(w => n.includes(w))).sort();
}

/** The icon as a data URI, ready to inline in the diagram page. */
export function iconData(query) {
  const icon = findIcon(query);
  if (!icon) return null;
  const svg = icon.svg ?? fs.readFileSync(icon.file, 'utf8');
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}
