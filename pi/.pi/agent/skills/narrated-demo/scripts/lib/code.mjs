// VS Code web walkthroughs, using the same browser and timing as app steps.
// Use a disposable local VS Code server/profile: prepareCode replaces its settings.
const modifier = process.platform === 'darwin' ? 'Meta' : 'Control';
const quickInput = page => page.locator('.quick-input-widget input');
const editor = '.monaco-editor:not(.chat-editor-overflow)';
const prepared = new WeakSet();

async function command(page, name) {
  await page.keyboard.press(`${modifier}+Shift+P`);
  await quickInput(page).fill(`>${name}`);
  await page.waitForTimeout(500);
  await quickInput(page).press('Enter');
  await page.waitForTimeout(700);
}

async function quickOpen(page, value) {
  await page.keyboard.press(`${modifier}+P`);
  await quickInput(page).fill(value);
  await page.waitForTimeout(300);
  await quickInput(page).press('Enter');
  await page.waitForTimeout(300);
}

/** Off-camera setup. Only editor preferences are written, never source files. */
export async function prepareCode(d, { url, file, line = 1 } = {}) {
  const page = d.page;
  if (url) await d.goto(url);
  await page.waitForSelector('.monaco-workbench', { timeout: 120_000 });
  if (prepared.has(page)) {
    if (file) await openCodeFile(d, file, line);
    return;
  }
  await command(page, 'Preferences: Open User Settings (JSON)');
  // Clicking the editor matters: focusing its hidden textarea does not activate
  // newer Monaco EditContext input. The last textarea may also belong to Chat.
  await page.locator(`${editor} .view-lines`).last().click({ position: { x: 50, y: 10 } });
  await page.keyboard.press(`${modifier}+A`);
  const settings = {
    'editor.fontSize': 22,
    'editor.lineHeight': 32,
    'editor.minimap.enabled': false,
    'editor.stickyScroll.enabled': false,
    'editor.wordWrap': 'on',
    'editor.cursorBlinking': 'solid',
    'workbench.colorTheme': 'Default Dark Modern',
    'workbench.statusBar.visible': false,
    'workbench.startupEditor': 'none',
    'workbench.tips.enabled': false,
    'breadcrumbs.enabled': false,
    'chat.disableAIFeatures': true,
    'zenMode.centerLayout': false,
    'zenMode.hideLineNumbers': false,
    'zenMode.fullScreen': false,
  };
  // Paste avoids both EditContext insertText failures and auto-indentation /
  // auto-closing brackets produced by typing an entire JSON document.
  await page.evaluate(text => navigator.clipboard.writeText(text), JSON.stringify(settings, null, 2));
  await page.keyboard.press(`${modifier}+V`);
  await page.keyboard.press(`${modifier}+S`);
  await page.waitForTimeout(800);
  await page.keyboard.press('Escape'); // dismiss the modal settings editor
  await page.waitForTimeout(250);
  await command(page, 'View: Toggle Zen Mode');
  prepared.add(page);
  if (file) await openCodeFile(d, file, line);
}

/** Open a repository-relative path, without typing into or saving its editor. */
export async function openCodeFile(d, file, line = 1) {
  await quickOpen(d.page, file);
  await d.page.waitForSelector(`${editor} .view-lines`);
  await quickOpen(d.page, `:${line}:1`);
}

/** Select a short range by its gutter, including wrapped source lines. */
export async function highlightCode(d, line, endLine = line) {
  if (!Number.isInteger(line) || line < 1 || !Number.isInteger(endLine) || endLine < line) {
    throw new Error('Code highlights need positive, ascending integer line numbers.');
  }
  await quickOpen(d.page, `:${line}:1`);
  const gutter = n => `${editor} .line-numbers:text-is("${n}")`;
  await d.click(gutter(line));
  if (endLine !== line) {
    await d.page.keyboard.down('Shift');
    try { await d.click(gutter(endLine)); }
    finally { await d.page.keyboard.up('Shift'); }
  }
}
