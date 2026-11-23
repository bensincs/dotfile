// A code walkthrough with a chalkboard summary: explains this skill's own scene rules.
// Line numbers refer to scripts/lib/scenes.mjs: update them if that file changes.
// Needs VS Code (its CLI's serve-web). From any scratch folder:
//
//   node <skill-dir>/scripts/narrate.mjs <skill-dir>/examples/code-tour.demo.mjs --draft --out ./narrated-examples
import { fileURLToPath } from 'node:url';

export default {
  name: 'code-tour',
  code: { root: fileURLToPath(new URL('..', import.meta.url)) },
  steps: [
    { say: 'This function decides which scene a step shows.', code: 'scripts/lib/scenes.mjs:13-24' },
    { say: 'A clay, code or draw field picks that scene.', code: { lines: [16, 18], note: 'one field, one scene' } },
    { say: 'Steps with only a line hold on the scene before them.', code: ':31-32', zoom: true },
    { say: 'So the rule is simple.', draw: [
      { title: 'Which scene?' },
      { box: 'clay / code / draw', id: 'field', at: [800, 330] },
      { arrow: ['field', 'scene'] },
      { box: 'that scene', id: 'scene', at: [800, 600] },
    ] },
    { say: 'Anything else stays where it is.', draw: [{ note: 'only say? hold', at: [1200, 600] }, { circle: 'scene' }] },
  ],
};
