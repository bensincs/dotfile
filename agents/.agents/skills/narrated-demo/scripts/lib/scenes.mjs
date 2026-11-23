// Scenes: which kind of picture each step shows.
//   app    a web app in the browser (do, annotate, zoom)
//   code   source files in VS Code (code)
//   board  a chalkboard that draws itself (draw, erase, board)
//   diagram  a clean architecture diagram with Azure icons (diagram)
//   text   big kinetic text: a headline, number, list, quote or stats (text)
//   terminal  commands typed into a terminal, with scripted or real output (terminal)
//   clay   a claymation set (clay)
// A step with only `say` holds on the scene before it. `scene: '…'` on a step forces one.
import { die } from './common.mjs';

export const SCENES = ['app', 'code', 'terminal', 'board', 'diagram', 'text', 'clay'];
const ALIASES = { web: 'app', chalkboard: 'board', claymation: 'clay', editor: 'code', architecture: 'diagram', title: 'text' };

/** The scene a step asks for itself, or null if it holds on the one before. */
export function ownScene(step, n) {
  const asked = [];
  if (step.scene) asked.push(ALIASES[step.scene] || step.scene);
  if (step.clay) asked.push('clay');
  if (step.code) asked.push('code');
  if (step.draw || step.erase || step.board) asked.push('board');
  if (step.diagram) asked.push('diagram');
  if (step.text !== undefined) asked.push('text');
  if (step.terminal !== undefined) asked.push('terminal');
  if (!step.scene && !asked.length && (step.annotate || typeof step.zoom === 'string' || (step.do && !step.cut))) asked.push('app');
  const unique = [...new Set(asked)];
  if (unique.some(s => !SCENES.includes(s))) die(`Step ${n}: unknown scene "${step.scene}". Use ${SCENES.join(', ')}.`);
  if (unique.length > 1) die(`Step ${n} mixes scenes (${unique.join(' and ')}). Give each scene its own step.`);
  if (step.annotate && ['board', 'clay', 'diagram', 'text', 'terminal'].includes(unique[0])) {
    const instead = { board: 'board, add items to draw', clay: 'clay set, use a bubble or a sign', diagram: 'diagram, use note', text: 'text, use sub', terminal: 'terminal, say it in the line' }[unique[0]];
    die(`Step ${n}: annotate draws over the app or the editor. On the ${instead} instead.`);
  }
  return unique[0] || null;
}

/** The scene of every step, in order. Cut steps are off camera: null. */
export function resolveScenes(spec) {
  let current = null;
  return spec.steps.map((step, i) => {
    if (step.cut) return null;
    const own = ownScene(step, i + 1);
    if (own) current = own;
    if (!current) {
      if (!spec.url) die(`Step ${i + 1} has nothing to show yet: give the spec a url, or start with a code, terminal, draw, diagram, text or clay step.`);
      current = 'app';
    }
    return current;
  });
}

export const isStateless = (step, scene) => scene !== 'app' && !step.do && !step.cut;
