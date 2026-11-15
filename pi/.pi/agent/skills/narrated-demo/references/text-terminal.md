# Big text and terminal scenes

Two scenes that help a story land: big text for hooks and takeaways, and a terminal for "run this".

## Big text

One statement, number, list, quote or row of stats, filling the screen and animating as it's spoken. Use it for the hook, a key number, a summary or the takeaway; keep it to a few steps a video.

```js
{ say: 'Setting up a new machine takes one command.', text: 'One command. *Every* tool.', caption: false },
{ say: 'Deployments failed far less often.', text: { number: '73%', label: 'fewer failed deployments', sub: 'after moving to private endpoints' } },
{ say: 'Three things changed.', text: { list: ['Private by default', 'No secrets in code', 'Every request traced'], title: 'What changed' } },
{ say: 'In their words.', text: { quote: 'We shipped the *whole* landing zone in an afternoon.', by: 'Platform team, Contoso' } },
{ say: 'Deploys went from 45 minutes to 3.', text: { stats: [{ value: '45 min', label: 'before' }, { value: '3 min', label: 'after', accent: true }], title: 'Time to deploy' } },
```

| `text` | Shows |
|---|---|
| `'A headline'` or `{ headline, sub }` | Words rise in one by one; `*word*` is in the accent colour |
| `{ number, label, sub }` | The number counts up (`'73%'`, `'$1.2M'`, `'3x'`, `'12'`) |
| `{ list, title }` | Items appear one at a time |
| `{ quote, by }` | A quotation |
| `{ stats: [{ value, label, accent }], title }` | Two to four numbers side by side, counting up |

- **`align: 'left'`** on the item for a left-aligned layout.
- **Spec options:** `text: { theme: 'dark' | 'light' | 'azure', accent: '#3fe0c0' }`.
- **`caption: false`** on a step hides its caption when the screen already shows the words. The subtitle file keeps it.

## Terminal

A real terminal (xterm.js) in a window titled with the shell and folder. Commands are typed at a human pace; output streams in with its colours.

```js
export default {
  terminal: { cwd: '.' },
  steps: [
    { say: 'First, see what is in the repository.', terminal: { run: 'git log --oneline -5 --color=always' } },
    { say: 'Then run the setup script.', terminal: { cmd: './bootstrap.sh', output: '▶ Installing…\n\x1b[32m✔\x1b[0m done' } },
    { say: 'And open a new shell.', terminal: 'exec zsh' },
  ],
};
```

| `terminal` on a step | Does |
|---|---|
| `'command'` | Types it; no output (an instruction, or a command that only changes the shell) |
| `{ cmd, output }` | Types it, then shows the given output. Safe and repeatable: use it for anything with side effects, slow commands, or output you want exact. |
| `{ run }` | Types it, and **really runs it** in `cwd` (off camera, before the step). Its real output, with colours, streams in. `timeout` (ms, default 120 000), `cwd` per command. |
| `[ … ]` | Several commands in one step, sharing the line's time |
| `{ clear: true }` | Clears the screen |

- **Spec options:** `terminal: { cwd, prompt, title, theme: 'dark' | 'light', fontSize: 22, env: {} }`. The prompt defaults to the folder name and `❯`; the title to `zsh — ~/folder`.
- **`run` executes on this machine,** every time its chapter records. Only use it for read-only commands (`git log`, `ls`, `az account show`, `--version`), or when the user asked for it. Use `{ cmd, output }` for everything else. Colours: many tools need a flag (`--color=always`); `FORCE_COLOR` and `CLICOLOR_FORCE` are set.
- **Don't show secrets:** tokens, connection strings, subscription IDs you shouldn't share, environment variables.

## Review

- Big text: the words fit and aren't hidden by the captions; `caption: false` where the caption only repeats them.
- Terminal: the command is readable before its output starts; no secrets on screen.
