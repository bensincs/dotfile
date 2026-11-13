// Paths, small helpers and the browser, shared by every part of narrated-demo.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SKILL = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const CONFIG = process.env.NARRATED_DEMO_CONFIG || path.join(os.homedir(), '.config/narrated-demo/config.json');
export const RUNTIME = process.env.NARRATED_DEMO_RUNTIME || path.join(os.homedir(), '.cache/narrated-demo');

export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
export function die(message) {
  console.error(`error: ${message}`);
  process.exit(1);
}

export const asset = file => fs.readFileSync(path.join(SKILL, 'assets', file), 'utf8');

/** A file from the runtime's node_modules (installed by setup.sh). */
export function dependency(file) {
  const full = path.join(RUNTIME, 'node_modules', file);
  if (!fs.existsSync(full)) die(`Missing ${file}. Run: ${SKILL}/scripts/setup.sh --runtime-only`);
  return full;
}

export async function launch({ headed = false } = {}) {
  const require = createRequire(path.join(RUNTIME, 'package.json'));
  let chromium;
  try { ({ chromium } = require('playwright')); } catch { die(`Playwright is not installed. Run: ${SKILL}/scripts/setup.sh --runtime-only`); }
  return chromium.launch({ channel: 'chrome', headless: !headed }).catch(() => chromium.launch({ headless: !headed }));
}

export const initials = name => name.split(/\s+/).filter(Boolean).map(w => w[0]).slice(0, 2).join('').toUpperCase();
