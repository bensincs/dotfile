// A clay-only story: a person ships a new version. No app, no editor; preview it in seconds:
//
//   node <skill-dir>/scripts/narrate.mjs <skill-dir>/examples/clay-story.demo.mjs --stills --out ./narrated-examples
//   node <skill-dir>/scripts/narrate.mjs <skill-dir>/examples/clay-story.demo.mjs --draft  --out ./narrated-examples
export default {
  name: 'clay-story',
  clay: {
    set: { name: 'studio', color: '#f4dcc6' },
    things: [
      { person: 'ada', at: [-2.0, 0.8], shirt: 'teal', hair: '#3b2a20', hairStyle: 'bun' },
      { laptop: 'dev', at: [-0.9, 0.5], screen: 'v2 ready ✓' },
      { parcel: 'v2', at: [-0.9, 1.3], label: 'v2' },
      { server: 'api', at: [2.3, -0.2] },
      { cloud: 'users', at: [-0.6, -1.6], label: 'users', hidden: true },
    ],
  },
  steps: [
    { say: 'Ada has just finished version two.', camera: ['ada', 'dev'], clay: [{ look: 'ada', at: 'dev' }, { nod: 'ada' }] },
    { say: 'She packs it up and carries it over to the server.', camera: 'wide', clay: [{ carry: 'v2', by: 'ada', to: 'api', side: 'left' }] },
    { say: 'The server lights up. Version two is live.', clay: [{ glow: 'api' }, { turn: 'ada', to: 'camera' }, { cheer: 'ada' }] },
    { say: 'And every user gets it, straight away.', clay: [{ bubble: 'ada', text: 'Shipped!' }, { appear: 'users' }, { move: 'v2', into: 'users' }] },
  ],
};
