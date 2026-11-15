// Azure AI Speech: config, Entra ID tokens, synthesis, voice lists and samples.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CONFIG, SKILL, die, sleep } from './common.mjs';

export function loadConfig() {
  if (!fs.existsSync(CONFIG)) die(`No config at ${CONFIG}. Run: ${SKILL}/scripts/setup.sh --subscription <id>`);
  return JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
}

export function saveConfig(config) {
  fs.writeFileSync(CONFIG, JSON.stringify(config, null, 2) + '\n');
}

let cachedToken;
function token(config) {
  if (cachedToken && cachedToken.expires > Date.now() + 60_000) return cachedToken.value;
  const out = execFileSync('az', ['account', 'get-access-token', '--subscription', config.subscription,
    '--resource', 'https://cognitiveservices.azure.com', '-o', 'json'], { encoding: 'utf8' });
  const { accessToken, expires_on: expiresOn } = JSON.parse(out);
  cachedToken = { value: accessToken, expires: Number(expiresOn) * 1000 };
  return accessToken;
}

const escapeXml = text => text.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);
// HD voices accept a subset of SSML; only send prosody when the rate actually changes.
const prosody = (rate, body) => (rate && rate !== '0%' ? `<prosody rate="${rate}">${body}</prosody>` : body);

/** Rewrites words the voice gets wrong ("G42" -> "G forty-two"). Captions keep the original text. */
export function spoken(text, pronounce = {}) {
  let out = text;
  for (const [word, say] of Object.entries(pronounce).sort((a, b) => b[0].length - a[0].length)) {
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp(`(?<![\\w-])${escaped}(?![\\w-])`, 'g'), say);
  }
  return out;
}

/** The SSML for one line. */
export function ssmlFor({ text, voice, rate, intro }) {
  const lang = voice.split('-').slice(0, 2).join('-');
  const lead = intro ? `${escapeXml(intro)}<break time="600ms"/>` : '';
  return `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="${lang}">`
    + `<voice name="${voice}">${prosody(rate, `${lead}${escapeXml(text)}`)}</voice></speak>`;
}

export async function synthesise(config, { text, voice, rate, intro }, file) {
  const ssml = ssmlFor({ text, voice, rate, intro });
  const url = new URL('tts/cognitiveservices/v1', config.endpoint);
  // 401/403 right after setup usually means the role assignment is still propagating.
  for (let attempt = 1; ; attempt++) {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token(config)}`,
        'Content-Type': 'application/ssml+xml',
        'X-Microsoft-OutputFormat': 'audio-48khz-192kbitrate-mono-mp3',
        'User-Agent': 'narrated-demo',
      },
      body: ssml,
    });
    if (response.ok) {
      fs.writeFileSync(file, Buffer.from(await response.arrayBuffer()));
      return;
    }
    const retry = [401, 403, 429, 500, 502, 503].includes(response.status) && attempt < 12;
    if (!retry) die(`Speech synthesis failed for ${voice}: ${response.status} ${await response.text()}`);
    const wait = response.status === 429 ? 3000 * attempt : 20_000;
    console.error(`  speech returned ${response.status}; retrying in ${wait / 1000}s (attempt ${attempt})`);
    await sleep(wait);
  }
}

export async function voiceList(config) {
  const response = await fetch(new URL('tts/cognitiveservices/voices/list', config.endpoint),
    { headers: { Authorization: `Bearer ${token(config)}` } });
  if (!response.ok) die(`Could not list voices: ${response.status} ${await response.text()}`);
  return (await response.json()).map(v => v.ShortName);
}

export function duration(file) {
  const out = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { encoding: 'utf8' });
  return Math.round(parseFloat(out) * 1000);
}

// Available in every region; only used to prove synthesis works.
export const CHECK_VOICE = 'en-US-AvaMultilingualNeural';
export const NO_VOICE = 'No voice chosen. Ask the user which voice they want: save it with --set-voice <voice>, '
  + 'or run --samples so they can listen first.';

// The most natural voices: Microsoft AI (MAI), Dragon HD and Azure OpenAI HD. Regions with
// HD voices include swedencentral, westeurope and eastus; elsewhere the standard set is used.
const PREMIUM_VOICES = [
  'en-GB-Emily:MAI-Voice-2.1', 'en-GB-Harry:MAI-Voice-2.1', 'en-US-Harper:MAI-Voice-2.1', 'en-US-Iris:MAI-Voice-2.1',
  'en-US-Olivia:MAI-Voice-2.1', 'en-US-Ethan:MAI-Voice-2.1', 'en-US-Grant:MAI-Voice-2.1', 'en-US-Sage:MAI-Voice-2.1',
  'en-AU-Isla:MAI-Voice-2.1',
  'en-GB-Ada:DragonHDLatestNeural', 'en-GB-Ollie:DragonHDLatestNeural', 'en-GB-Ryan:DragonHDLatestNeural',
  'en-US-Ava:DragonHDLatestNeural', 'en-US-Andrew:DragonHDLatestNeural', 'en-US-Emma:DragonHDLatestNeural',
  'en-US-Brian:DragonHDLatestNeural', 'en-US-Phoebe:DragonHDLatestNeural', 'en-US-Davis:DragonHDLatestNeural',
  'en-US-NovaMultilingualNeuralHD', 'en-US-AlloyMultilingualNeuralHD', 'en-US-FableMultilingualNeuralHD',
  'en-US-ShimmerMultilingualNeuralHD',
];
const STANDARD_VOICES = [
  'en-GB-RyanNeural', 'en-GB-LibbyNeural', 'en-GB-AdaMultilingualNeural', 'en-GB-OllieMultilingualNeural',
  'en-GB-ThomasNeural', 'en-GB-OliviaNeural',
  'en-US-AvaMultilingualNeural', 'en-US-AndrewMultilingualNeural', 'en-US-EmmaMultilingualNeural',
  'en-US-BrianMultilingualNeural', 'en-US-SerenaMultilingualNeural', 'en-US-DavisMultilingualNeural',
  'en-US-NovaTurboMultilingualNeural', 'en-US-AlloyTurboMultilingualNeural',
  'en-AU-NatashaNeural', 'en-AU-WilliamMultilingualNeural', 'en-IE-EmilyNeural', 'en-IE-ConnorNeural',
  'en-GB-SoniaNeural',
];
const SAMPLE_TEXT = 'Here is a short sample of how this voice narrates a product demo. '
  + 'It explains each step clearly, and keeps a calm, steady pace from start to finish.';

/** One file per voice, each starting with the voice's name, plus all of them in one file. */
export async function samples(config, { voices: chosen, text, dir }) {
  const available = new Set(await voiceList(config));
  const premium = PREMIUM_VOICES.filter(v => available.has(v));
  const voices = chosen || (premium.length ? premium : STANDARD_VOICES);
  const missing = voices.filter(v => !available.has(v));
  if (missing.length) die(`Not available in ${config.location}: ${missing.join(', ')}`);
  if (!chosen && !premium.length) console.log(`No HD voices in ${config.location}; sampling standard voices. HD regions include swedencentral.`);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const files = [];
  for (const [i, voice] of voices.entries()) {
    const locale = voice.split('-').slice(0, 2).join('-');
    const person = voice.split('-')[2].split(':')[0].replace(/(Turbo)?(Multilingual)?Neural(HD)?$/, '');
    const file = path.join(dir, `${String(i + 1).padStart(2, '0')}-${voice.replace(/[:.]/g, '_')}.mp3`);
    await synthesise(config, { text: text || SAMPLE_TEXT, voice, rate: '0%', intro: `${person}.` }, file);
    files.push(file);
    console.log(`${String(i + 1).padStart(2)}. ${voice.padEnd(38)} ${locale} ${(duration(file) / 1000).toFixed(1)}s`);
  }
  const list = path.join(os.tmpdir(), 'narrated-demo-samples.txt');
  const gap = path.join(os.tmpdir(), 'narrated-demo-gap.mp3');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=mono', '-t', '1', '-c:a', 'libmp3lame', '-b:a', '192k', gap]);
  fs.writeFileSync(list, files.flatMap(f => [`file '${f}'`, `file '${gap}'`]).join('\n'));
  const all = path.join(dir, 'all-voices.mp3');
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', list, '-c:a', 'libmp3lame', '-b:a', '192k', all]);
  console.log(`\nSamples: ${dir}\nAll in one: ${all}`);
}
