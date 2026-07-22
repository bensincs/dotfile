// Two-way Telegram bridge for opencode: one forum topic per window.
//
// OUTGOING: each opencode WINDOW gets one forum topic in your group. The topic
// is created when the window opens, its name tracks the current session's title,
// the assistant's responses are posted into it, and it is DELETED when the
// window closes (via the liveness reaper -- see below).
//
// INCOMING: a message you type INSIDE a window's topic is fed into that window's
// current session as a new prompt. DMs to the bot and the group's General topic
// are ignored.
//
//   A Telegram bot has ONE incoming stream (getUpdates is single-consumer and
//   can't be filtered per-topic), so we can't let every window poll. Instead one
//   window is ELECTED (lock file + pid-liveness failover) to drain the stream;
//   it drops each topic's message into the owning window's local inbox file, and
//   every window injects its OWN inbox into its own session. Single bot, no
//   daemon, automatic failover.
//
// DELETE-ON-CLOSE: a plugin can't reliably fire a network call at the instant
// its own process dies, so each window records its PID next to its topic and
// every running window (plus the next one you open) deletes the topic (+ inbox)
// of any window whose process is gone.
//
// Env vars:
//   TELEGRAM_BOT_TOKEN             (required) bot token from @BotFather
//   TELEGRAM_GROUP_ID              (required) forum supergroup id (e.g. -100123...)
//   TELEGRAM_DISABLE_INCOMING      set to "1" to run outgoing-only
//   TELEGRAM_NOTIFY_PREFIX         optional string prepended to outgoing messages
//                                  (default: "@<TELEGRAM_USERNAME> " if TELEGRAM_USERNAME set)
//   TELEGRAM_USERNAME              optional Telegram handle (without @) used as default notify prefix
//   TELEGRAM_DISABLE_NOTIFICATIONS set to "1" to send messages silently (disable notifications)
//
// Setup: create a supergroup, turn ON Topics, add the bot as an admin WITH
// "Manage Topics". For INCOMING, also disable the bot's privacy mode in
// @BotFather (/setprivacy -> Disable) so it can see messages typed in topics.

// Note: this plugin now depends on the `markdown-it` package. Ensure it's
// installed in the runtime environment (e.g. `npm install markdown-it`).

import {
  mkdir,
  readdir,
  readFile,
  writeFile,
  appendFile,
  unlink,
  stat,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import MarkdownIt from "markdown-it";

const API = "https://api.telegram.org";
const TG_LIMIT = 4096; // Telegram max message length
const TOPIC_NAME_LIMIT = 128; // Telegram max forum-topic name length
const SWEEP_MS = 20_000; // reap dead windows this often
const INBOX_POLL_MS = 1_500; // check our own inbox this often
const POLLER_TICK_MS = 10_000; // try to (re)claim the poller role this often
const POLLER_YIELD_MS = 30_000; // back off this long after a 409 conflict
const LONG_POLL_S = 25; // getUpdates long-poll timeout
const TYPING_ACTION_MS = 4_000; // re-send "typing" this often while replying
const TYPING_MAX_MS = 20 * 60_000; // safety cap so typing can't get stuck on
const SEND_GAP_MS = 1_100; // min spacing between queued sends (~1 msg/sec/chat)
const SEND_MAX_RETRIES = 5; // per-message retry attempts on 429/transient errors

const ROOT = path.join(
  process.env.XDG_STATE_HOME || path.join(os.homedir(), ".local", "state"),
  "opencode-telegram",
);
const WINDOWS_DIR = path.join(ROOT, "windows"); // <pid>.json -> {pid,threadId,chatId}
const INBOX_DIR = path.join(ROOT, "inbox"); // <pid>.jsonl -> queued incoming
const LOCK_FILE = path.join(ROOT, "poller.lock");
const OFFSET_FILE = path.join(ROOT, "offset.json");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Render Markdown to an HTML subset compatible with Telegram's HTML parse_mode.
// markdown-it does the parsing; custom renderer rules map every construct onto
// the tags Telegram actually supports (<b>, <i>, <s>, <a>, <code>, <pre>) or a
// plaintext equivalent. Raw HTML in the source is disabled. Coverage:
//   headings          -> <b>…</b>
//   bold / italic     -> <b> / <i>
//   strikethrough     -> <s>
//   inline code       -> <code>
//   fenced/indented   -> <pre>
//   links             -> <a href>
//   images            -> <a href> to the source with alt text
//   bullet/ordered    -> "• " / "N. " with nesting indentation
//   blockquotes       -> "> " prefix
//   horizontal rules  -> "———"
//   tables            -> aligned monospace ASCII inside <pre>
function mdToHtml(mdText) {
  if (typeof mdText !== "string") return "";
  const md = new MarkdownIt({ html: false, linkify: true });

  // Override renderer rules to emit Telegram-friendly HTML only.
  const r = md.renderer.rules;

  r.paragraph_open = (tokens, idx) => (tokens[idx].hidden ? "" : "");
  r.paragraph_close = (tokens, idx) => (tokens[idx].hidden ? "" : "\n\n");
  r.softbreak = () => "\n";
  r.hardbreak = () => "\n";

  r.heading_open = (tokens, idx) => {
    return "<b>";
  };
  r.heading_close = () => "</b>\n\n";

  r.strong_open = () => "<b>";
  r.strong_close = () => "</b>";
  r.em_open = () => "<i>";
  r.em_close = () => "</i>";

  r.code_inline = (tokens, idx) => {
    const content = md.utils.escapeHtml(tokens[idx].content);
    return `<code>${content}</code>`;
  };

  r.fence = (tokens, idx) => {
    const content = md.utils.escapeHtml(tokens[idx].content);
    return `<pre>${content}</pre>\n\n`;
  };

  // Links: render as <a href="...">text</a>
  r.link_open = (tokens, idx) => {
    const href = tokens[idx].attrGet("href") || "";
    const safe = String(href).replace(/"/g, "'");
    return `<a href="${safe}">`;
  };
  r.link_close = () => `</a>`;

  // Lists: bullets and ordered, with nesting-aware indentation.
  const listStack = [];
  r.bullet_list_open = () => {
    listStack.push({ type: "bullet" });
    return "";
  };
  r.bullet_list_close = () => {
    listStack.pop();
    return listStack.length ? "" : "\n";
  };
  r.ordered_list_open = (tokens, idx) => {
    const start = Number(tokens[idx].attrGet && tokens[idx].attrGet("start")) || 1;
    listStack.push({ type: "ordered", counter: start });
    return "";
  };
  r.ordered_list_close = () => {
    listStack.pop();
    return listStack.length ? "" : "\n";
  };
  r.list_item_open = () => {
    const depth = Math.max(0, listStack.length - 1);
    const indent = "  ".repeat(depth);
    const top = listStack[listStack.length - 1];
    if (top && top.type === "ordered") {
      const num = top.counter++;
      return `\n${indent}${num}. `;
    }
    return `\n${indent}• `;
  };
  r.list_item_close = () => "";

  // Blockquotes: prefix a "> " marker.
  r.blockquote_open = () => "> ";
  r.blockquote_close = () => "\n";

  // Horizontal rule.
  r.hr = () => "\n———\n\n";

  // Strikethrough (GFM ~~text~~).
  r.s_open = () => "<s>";
  r.s_close = () => "</s>";
  r.del_open = () => "<s>";
  r.del_close = () => "</s>";

  // Images: Telegram HTML can't embed, so link to the source with alt text.
  r.image = (tokens, idx) => {
    const src = tokens[idx].attrGet("src") || "";
    const alt = md.utils.escapeHtml(tokens[idx].content || "image");
    const safe = String(src).replace(/"/g, "'");
    return safe ? `<a href="${safe}">${alt}</a>` : alt;
  };

  // Render HTML then post-process tables into monospace ASCII inside <pre>
  let html = md.render(mdText).trim();

  // Helper: decode basic HTML entities and numeric entities
  function decodeEntities(s) {
    if (!s) return "";
    return s
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&#(\d+);/g, (m, n) => String.fromCharCode(Number(n)));
  }

  // Convert each <table>...</table> to an ASCII table inside <pre>
  html = html.replace(/<table[\s\S]*?<\/table>/gi, (tableHtml) => {
    // extract rows
    const rowMatches = Array.from(tableHtml.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi));
    if (!rowMatches.length) return tableHtml;
    const rows = [];
    const isHeaderRow = [];
    for (const rm of rowMatches) {
      const tr = rm[1];
      const cells = Array.from(tr.matchAll(/<(t[dh])[^>]*>([\s\S]*?)<\/t[dh]>/gi));
      if (!cells.length) continue;
      const row = cells.map((c) => {
        // strip inner tags and decode entities
        const inner = c[2].replace(/<[^>]+>/g, "");
        return decodeEntities(inner).trim();
      });
      rows.push(row);
      // mark header if first cell tag was TH
      isHeaderRow.push(/<th[\s\S]*?>/i.test(rm[0]));
    }

    if (!rows.length) return tableHtml;

    // calculate column widths
    const cols = Math.max(...rows.map((r) => r.length));
    const widths = new Array(cols).fill(0);
    for (const r of rows) {
      for (let i = 0; i < cols; i++) {
        const cell = String(r[i] ?? "");
        widths[i] = Math.max(widths[i], cell.length);
      }
    }

    // build ascii lines
    const lines = [];
    for (let ri = 0; ri < rows.length; ri++) {
      const r = rows[ri];
      const parts = [];
      for (let ci = 0; ci < cols; ci++) {
        const cell = String(r[ci] ?? "");
        const pad = widths[ci] - cell.length;
        parts.push(cell + " ".repeat(pad));
      }
      lines.push(`| ${parts.join(' | ')} |`);
      // after first row, insert separator
      if (ri === 0) {
        const sep = widths.map((w) => "-".repeat(w));
        lines.push(`| ${sep.join(' | ')} |`);
      }
    }

    const pre = `<pre>${md.utils.escapeHtml(lines.join("\n"))}</pre>`;
    return pre;
  });

  // Normalize whitespace OUTSIDE <pre> blocks: collapse 3+ newlines to 2 and
  // trim trailing spaces, while leaving preformatted content untouched.
  html = html
    .split(/(<pre>[\s\S]*?<\/pre>)/g)
    .map((seg) =>
      seg.startsWith("<pre>")
        ? seg
        : seg.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n"),
    )
    .join("")
    .trim();

  return html;
}

// Split rendered HTML into <= max chunks WITHOUT cutting inside a tag or an
// open element. We break on blank lines / newlines when possible, and close +
// reopen <pre>/<code> spans so each chunk is independently valid HTML. Any
// single line longer than max is hard-split on a tag boundary as a last resort.
function splitHtml(html, max = TG_LIMIT) {
  if (typeof html !== "string" || html.length <= max) {
    return html ? [html] : [];
  }

  // Tokenize into tags and text runs so we never split inside a "<...>".
  const tokens = html.match(/<[^>]+>|[^<]+/g) || [];
  const chunks = [];
  let cur = "";
  const openStack = []; // currently-open formatting tags, e.g. ["pre","b"]

  const tagName = (t) => {
    const m = /^<\s*(\/?)\s*([a-zA-Z0-9]+)/.exec(t);
    return m ? { closing: m[1] === "/", name: m[2].toLowerCase() } : null;
  };
  const openTagsHtml = () => openStack.map((n) => `<${n}>`).join("");
  const closeTagsHtml = () =>
    openStack.map((n) => `</${n}>`).reverse().join("");

  const flush = () => {
    if (!cur) return;
    chunks.push(cur + closeTagsHtml());
    cur = openTagsHtml();
  };

  // Max content length for `cur` before we must close open tags: reserve room
  // for the closing tags so the emitted chunk stays within `max`.
  const budget = () => max - closeTagsHtml().length;

  for (let token of tokens) {
    // If adding this token overflows the budget, flush or hard-split first.
    while (cur.length + token.length > budget()) {
      // If cur holds real content (beyond just reopened tags), flush it.
      if (cur.length > openTagsHtml().length) {
        flush();
        continue;
      }
      // cur is only reopened tags (or empty) but the token still won't fit.
      if (token.startsWith("<")) {
        // A single tag longer than budget should never happen; emit as-is.
        chunks.push(cur + token);
        cur = openTagsHtml();
        token = "";
        break;
      }
      // Hard-split an over-long text run, preferring a space boundary.
      const room = Math.max(1, budget() - cur.length);
      const space = token.lastIndexOf(" ", room);
      const cut = space > 0 ? space : room;
      chunks.push(cur + token.slice(0, cut) + closeTagsHtml());
      cur = openTagsHtml();
      token = token.slice(cut);
    }
    if (!token) continue;
    cur += token;
    const info = tagName(token);
    if (info) {
      if (!info.closing) openStack.push(info.name);
      else {
        const i = openStack.lastIndexOf(info.name);
        if (i !== -1) openStack.splice(i, 1);
      }
    }
  }
  if (cur && cur !== openTagsHtml()) chunks.push(cur);
  return chunks;
}

// true = working, false = idle, null = unknown, from a session.status value.
function statusIsWorking(status) {
  if (typeof status !== "string") return null;
  switch (status.toLowerCase()) {
    case "idle":
      return false;
    case "active":
    case "busy":
    case "pending":
    case "running":
    case "streaming":
    case "working":
      return true;
    default:
      return null;
  }
}

async function tg(token, method, params) {
  try {
    const res = await fetch(`${API}/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
      signal: AbortSignal.timeout((params?.timeout ?? 8) * 1000 + 5000),
    });
    return await res.json().catch(() => ({ ok: false }));
  } catch (err) {
    return { ok: false, description: String(err) };
  }
}

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err?.code === "EPERM";
  }
}

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return null;
  }
}

export const TelegramNotifyPlugin = async ({ client, directory }) => {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const groupId = process.env.TELEGRAM_GROUP_ID;
  if (!token || !groupId) return {};
  const incomingEnabled = process.env.TELEGRAM_DISABLE_INCOMING !== "1";

  const log = async (level, message, extra) => {
    try {
      await client.app.log({
        body: { service: "telegram-notify", level, message, extra },
      });
    } catch {
      // best-effort
    }
  };

  const projectName =
    (typeof directory === "string" &&
      directory &&
      directory.split("/").filter(Boolean).pop()) ||
    "opencode";

  // Track subagent/child sessions so their activity never drives the topic.
  const childSessions = new Set();
  const noteInfo = (info) => {
    if (info?.id && info?.parentID) childSessions.add(info.id);
  };
  const isChild = (sessionID) => !sessionID || childSessions.has(sessionID);

  async function latestAssistantText(sessionID) {
    try {
      const res = await client.session.messages({ path: { id: sessionID } });
      const rows = res?.data ?? [];
      for (let i = rows.length - 1; i >= 0; i--) {
        if (rows[i]?.info?.role === "assistant") {
          return (rows[i].parts ?? [])
            .filter((p) => p?.type === "text" && typeof p.text === "string")
            .map((p) => p.text)
            .join("")
            .trim();
        }
      }
    } catch (err) {
      await log("error", "failed to read session messages", { error: String(err) });
    }
    return "";
  }

  // ===========================================================================
  // Per-window topic state
  // ===========================================================================
  const ownWindowFile = path.join(WINDOWS_DIR, `${process.pid}.json`);
  const ownInboxFile = path.join(INBOX_DIR, `${process.pid}.jsonl`);

  let threadId = null;
  let topicDisabled = false;
  let appliedName = null;
  let currentSessionID = null;
  let creating = null;

  async function writeOwnState() {
    if (!threadId) return;
    try {
      await mkdir(WINDOWS_DIR, { recursive: true });
      await writeFile(
        ownWindowFile,
        JSON.stringify({ pid: process.pid, threadId, chatId: groupId }),
      );
    } catch (err) {
      await log("warn", "failed to write window state", { error: String(err) });
    }
  }

  async function ensureTopic() {
    if (threadId || topicDisabled) return threadId;
    if (!creating) {
      creating = (async () => {
        const name = (appliedName || projectName).slice(0, TOPIC_NAME_LIMIT);
        const r = await tg(token, "createForumTopic", { chat_id: groupId, name });
        if (r?.ok && r.result?.message_thread_id) {
          threadId = r.result.message_thread_id;
          appliedName = name;
          await writeOwnState();
          await log("info", "created forum topic", { threadId, name });
        } else {
          topicDisabled = true;
          await log(
            "error",
            "createForumTopic failed; topic mode disabled (bot admin + Manage Topics + Topics enabled?)",
            { description: r?.description },
          );
        }
        return threadId;
      })();
    }
    try {
      return await creating;
    } finally {
      creating = null;
    }
  }

  async function renameTopic(name) {
    const clean = (name || "").trim().slice(0, TOPIC_NAME_LIMIT);
    if (!threadId || topicDisabled || !clean || clean === appliedName) return;
    const r = await tg(token, "editForumTopic", {
      chat_id: groupId,
      message_thread_id: threadId,
      name: clean,
    });
    if (r?.ok) {
      await log("info", "renamed topic", { from: appliedName, to: clean });
      appliedName = clean;
    } else {
      await log("warn", "editForumTopic failed", { description: r?.description });
    }
  }

  // Rename the topic to a session's title (fetch it if not supplied). Titles are
  // cached and fetches are throttled, because message.updated fires rapidly.
  const titleCache = new Map(); // sessionID -> last known title
  const lastTitleFetch = new Map(); // sessionID -> ts of last session.get
  async function syncTitle(sessionID, hint) {
    if (isChild(sessionID)) return;
    if (hint) {
      titleCache.set(sessionID, hint);
      await renameTopic(hint);
      return;
    }
    const cached = titleCache.get(sessionID);
    if (cached) {
      await renameTopic(cached);
      return;
    }
    const now = Date.now();
    if (now - (lastTitleFetch.get(sessionID) || 0) < 4000) return;
    lastTitleFetch.set(sessionID, now);
    try {
      const s = (await client.session.get({ path: { id: sessionID } }))?.data;
      if (s?.parentID) {
        childSessions.add(sessionID);
        return;
      }
      if (s?.title) {
        titleCache.set(sessionID, s.title);
        await renameTopic(s.title);
      }
    } catch {
      // ignore
    }
  }

  // ===========================================================================
  // Outgoing send queue: serialize sendMessage calls, pace them to respect
  // Telegram's per-chat rate limit, and retry on 429 using retry_after. Without
  // this, bursts of chunked replies get 429'd and silently dropped.
  // ===========================================================================
  const sendQueue = [];
  let sendDraining = false;
  let lastSendAt = 0;

  async function drainSendQueue() {
    if (sendDraining) return;
    sendDraining = true;
    try {
      while (sendQueue.length) {
        const job = sendQueue[0];
        // Pace: ensure a minimum gap since the previous successful send.
        const wait = SEND_GAP_MS - (Date.now() - lastSendAt);
        if (wait > 0) await sleep(wait);

        const r = await tg(token, "sendMessage", job.payload);
        if (r?.ok) {
          lastSendAt = Date.now();
          sendQueue.shift();
          continue;
        }

        // 429 -> honor retry_after and try the SAME job again (don't drop it).
        if (r?.error_code === 429) {
          const retryAfter = Number(r?.parameters?.retry_after) || 1;
          await log("warn", "sendMessage rate-limited; backing off", {
            retry_after: retryAfter,
            attempt: job.attempts + 1,
            queued: sendQueue.length,
          });
          job.attempts += 1;
          if (job.attempts >= SEND_MAX_RETRIES) {
            await log("error", "sendMessage dropped after retries (429)", {
              description: r?.description,
            });
            sendQueue.shift();
          } else {
            await sleep(retryAfter * 1000 + 250);
          }
          continue;
        }

        // Other errors: log and retry a few times, else drop so the queue moves.
        job.attempts += 1;
        await log("error", "sendMessage failed", {
          error_code: r?.error_code,
          description: r?.description,
          attempt: job.attempts,
        });
        if (job.attempts >= SEND_MAX_RETRIES) {
          sendQueue.shift();
        } else {
          await sleep(500 * job.attempts);
        }
      }
    } finally {
      sendDraining = false;
    }
  }

  function enqueueSend(payload) {
    sendQueue.push({ payload, attempts: 0 });
    drainSendQueue().catch(async (e) =>
      log("error", "send queue crashed", { error: String(e) }),
    );
  }

  async function postResponse(sessionID) {
    const tid = await ensureTopic();
    if (!tid) return;
    const text = await latestAssistantText(sessionID);
    if (!text) return;
    // Allow optional mention prefix to try to trigger notifications. If
    // TELEGRAM_NOTIFY_PREFIX is set (e.g. "@username" or "<a\n...>"), it
    // will be prepended to the message. Keep it configurable because some
    // groups suppress notifications for bot messages.
    // Default prefix resolution: explicit TELEGRAM_NOTIFY_PREFIX first, then
    // TELEGRAM_USERNAME -> "@username ", otherwise empty.
    const prefix =
      process.env.TELEGRAM_NOTIFY_PREFIX ||
      (process.env.TELEGRAM_USERNAME ? `@${process.env.TELEGRAM_USERNAME} ` : "");
    const silent = process.env.TELEGRAM_DISABLE_NOTIFICATIONS === "1";

    // Render the full response, then split into HTML-valid chunks that each fit
    // Telegram's limit (leaving room for the prefix on the first chunk).
    const html = mdToHtml(text);
    const chunks = splitHtml(html, TG_LIMIT - prefix.length);
    if (!chunks.length) return;

    // Enqueue every chunk; the queue serializes, paces, and retries them so
    // none are dropped to rate limiting.
    for (let i = 0; i < chunks.length; i++) {
      enqueueSend({
        chat_id: groupId,
        message_thread_id: tid,
        text: (i === 0 ? prefix : "") + chunks[i],
        parse_mode: "HTML",
        disable_web_page_preview: true,
        // Only the first chunk should ping; the rest arrive silently.
        disable_notification: silent || i > 0,
      });
    }
  }

  // ---- "typing…" indicator while the assistant is replying -----------------
  // Telegram's chat action lasts ~5s, so re-send it on an interval until idle.
  let typingTimer = null;
  let typingStart = 0;
  async function sendTyping() {
    const tid = await ensureTopic();
    if (!tid) return;
    const r = await tg(token, "sendChatAction", {
      chat_id: groupId,
      message_thread_id: tid,
      action: "typing",
    });
    // Typing is best-effort, but log failures so flakiness is diagnosable.
    if (r && r.ok === false) {
      await log("warn", "sendChatAction (typing) failed", {
        error_code: r?.error_code,
        description: r?.description,
      });
    }
  }
  function startTyping() {
    if (typingTimer) return;
    typingStart = Date.now();
    sendTyping().catch(() => {});
    typingTimer = setInterval(() => {
      if (Date.now() - typingStart > TYPING_MAX_MS) return stopTyping();
      sendTyping().catch(() => {});
    }, TYPING_ACTION_MS);
    if (typeof typingTimer.unref === "function") typingTimer.unref();
  }
  function stopTyping() {
    if (typingTimer) {
      clearInterval(typingTimer);
      typingTimer = null;
    }
  }

  // ===========================================================================
  // Reaper: delete topics + drop inbox files for windows whose process is gone.
  // ===========================================================================
  async function sweep() {
    let files;
    try {
      files = await readdir(WINDOWS_DIR);
    } catch {
      return;
    }
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const pid = Number.parseInt(file, 10);
      if (!Number.isFinite(pid) || pid === process.pid || pidAlive(pid)) continue;

      const entry = await readJson(path.join(WINDOWS_DIR, file));
      if (entry?.threadId) {
        await tg(token, "deleteForumTopic", {
          chat_id: entry.chatId ?? groupId,
          message_thread_id: entry.threadId,
        });
      }
      for (const f of [
        path.join(WINDOWS_DIR, file),
        path.join(INBOX_DIR, `${pid}.jsonl`),
      ]) {
        try {
          await unlink(f);
        } catch {
          // already gone / reaped by another window
        }
      }
    }
  }

  // ===========================================================================
  // INCOMING: elected poller -> per-window inbox -> local prompt injection
  // ===========================================================================
  let isPoller = false;
  let pollerRunning = false;
  let yieldUntil = 0;
  let stopped = false;

  async function tryBecomePoller() {
    try {
      await mkdir(ROOT, { recursive: true });
      await writeFile(
        LOCK_FILE,
        JSON.stringify({ pid: process.pid, ts: Date.now() }),
        { flag: "wx" }, // atomic: fail if it already exists
      );
      return true;
    } catch {
      const cur = await readJson(LOCK_FILE);
      if (cur?.pid && cur.pid !== process.pid && pidAlive(cur.pid)) return false;
      // stale (dead owner) or ours -> take it over
      try {
        await writeFile(
          LOCK_FILE,
          JSON.stringify({ pid: process.pid, ts: Date.now() }),
        );
        return true;
      } catch {
        return false;
      }
    }
  }

  async function releasePoller() {
    isPoller = false;
    const cur = await readJson(LOCK_FILE);
    if (cur?.pid === process.pid) {
      try {
        await unlink(LOCK_FILE);
      } catch {
        // ignore
      }
    }
  }

  async function findWindowByThread(thread) {
    let files;
    try {
      files = await readdir(WINDOWS_DIR);
    } catch {
      return null;
    }
    for (const f of files) {
      if (!f.endsWith(".json")) continue;
      const e = await readJson(path.join(WINDOWS_DIR, f));
      if (e?.threadId === thread && e?.pid && pidAlive(e.pid)) return e;
    }
    return null;
  }

  async function routeUpdate(update) {
    const m = update?.message;
    if (!m || m.from?.is_bot) return;
    if (String(m.chat?.id) !== String(groupId)) return; // DMs / other chats
    if (!m.is_topic_message || !m.message_thread_id) return; // General topic
    const text = typeof m.text === "string" ? m.text.trim() : "";
    if (!text) return;

    const target = await findWindowByThread(m.message_thread_id);
    if (!target) return; // topic whose window is gone -> drop
    try {
      await mkdir(INBOX_DIR, { recursive: true });
      await appendFile(
        path.join(INBOX_DIR, `${target.pid}.jsonl`),
        JSON.stringify({ update_id: update.update_id, text, ts: Date.now() }) + "\n",
      );
    } catch (err) {
      await log("warn", "inbox append failed", { error: String(err) });
    }
  }

  async function pollLoop() {
    // Prime the offset so we don't replay old backlog on first run.
    let offset = (await readJson(OFFSET_FILE))?.offset;
    if (typeof offset !== "number") {
      const prime = await tg(token, "getUpdates", { offset: -1, timeout: 0 });
      const last = prime?.ok && prime.result?.length ? prime.result.at(-1) : null;
      offset = last ? last.update_id + 1 : 0;
      await writeFile(OFFSET_FILE, JSON.stringify({ offset })).catch(() => {});
    }

    while (isPoller && !stopped) {
      const r = await tg(token, "getUpdates", {
        offset,
        timeout: LONG_POLL_S,
        allowed_updates: ["message"],
      });
      if (!r?.ok) {
        if (r?.error_code === 409) {
          // another poller exists -> yield and back off
          yieldUntil = Date.now() + POLLER_YIELD_MS;
          await releasePoller();
          return;
        }
        await sleep(3000);
        continue;
      }
      for (const update of r.result ?? []) {
        offset = update.update_id + 1;
        await routeUpdate(update);
      }
      if (r.result?.length) {
        await writeFile(OFFSET_FILE, JSON.stringify({ offset })).catch(() => {});
      }
    }
  }

  async function pollerTick() {
    if (!incomingEnabled || pollerRunning || stopped) return;
    if (Date.now() < yieldUntil) return;
    if (await tryBecomePoller()) {
      isPoller = true;
      pollerRunning = true;
      pollLoop()
        .catch(async (e) => log("error", "poll loop crashed", { error: String(e) }))
        .finally(() => {
          pollerRunning = false;
          isPoller = false;
        });
    }
  }

  // ---- Inbox consumer (runs in every window, drains its OWN inbox) ----------
  let inboxReadBytes = 0;
  const seenUpdateIds = new Set();

  async function injectPrompt(text) {
    let sid = currentSessionID;
    if (!sid) {
      try {
        sid = (await client.session.create({ body: {} }))?.data?.id;
        currentSessionID = sid;
      } catch (err) {
        await log("error", "failed to create session for incoming", {
          error: String(err),
        });
        return;
      }
    }
    if (!sid) return;
    startTyping(); // Telegram-initiated turn -> show typing immediately
    try {
      await client.session.prompt({
        path: { id: sid },
        body: { parts: [{ type: "text", text }] },
      });
    } catch (err) {
      await log("error", "failed to inject prompt", { error: String(err) });
    }
  }

  async function drainInbox() {
    let content;
    try {
      content = await readFile(ownInboxFile, "utf8");
    } catch {
      return;
    }
    if (content.length <= inboxReadBytes) {
      inboxReadBytes = content.length; // file truncated/rotated
      return;
    }
    const fresh = content.slice(inboxReadBytes);
    inboxReadBytes = content.length;
    for (const line of fresh.split("\n")) {
      const s = line.trim();
      if (!s) continue;
      let msg;
      try {
        msg = JSON.parse(s);
      } catch {
        continue;
      }
      if (msg.update_id) {
        if (seenUpdateIds.has(msg.update_id)) continue;
        seenUpdateIds.add(msg.update_id);
      }
      if (typeof msg.text === "string" && msg.text) await injectPrompt(msg.text);
    }
  }

  // ===========================================================================
  // Startup
  // ===========================================================================
  ensureTopic().catch(() => {});
  sweep().catch(() => {});
  const timers = [
    setInterval(() => sweep().catch(() => {}), SWEEP_MS),
  ];
  if (incomingEnabled) {
    // Skip whatever is already in our inbox at startup; only handle new lines.
    stat(ownInboxFile)
      .then((s) => {
        inboxReadBytes = s.size;
      })
      .catch(() => {});
    pollerTick().catch(() => {});
    timers.push(
      setInterval(() => pollerTick().catch(() => {}), POLLER_TICK_MS),
      setInterval(() => drainInbox().catch(() => {}), INBOX_POLL_MS),
    );
  }
  for (const t of timers) if (typeof t.unref === "function") t.unref();

  // ===========================================================================
  // Hooks
  // ===========================================================================
  // Mark the active session + keep the topic name in sync. Mirrors the event
  // handling in the herdr-pane-title plugin so switching/resuming a session
  // updates the name as soon as you interact with it.
  async function onActiveSession(sessionID, titleHint) {
    if (isChild(sessionID)) return;
    currentSessionID = sessionID;
    await ensureTopic();
    await syncTitle(sessionID, titleHint);
  }

  return {
    "chat.message": async ({ sessionID }) => {
      try {
        await onActiveSession(sessionID);
        if (!isChild(sessionID)) startTyping();
      } catch (err) {
        await log("error", "chat.message handler failed", { error: String(err) });
      }
    },
    event: async ({ event }) => {
      try {
        const type = event?.type;
        const props = event?.properties ?? {};
        const info = props.info;
        noteInfo(info);

        switch (type) {
          case "session.created":
          case "session.updated":
            if (info && !info.parentID && typeof info.title === "string") {
              await onActiveSession(info.id, info.title);
            }
            break;
          case "message.updated":
          case "session.compacted":
            await onActiveSession(props.sessionID ?? info?.sessionID);
            break;
          case "session.status": {
            const sid = props.sessionID ?? info?.sessionID;
            await onActiveSession(sid);
            const working = statusIsWorking(props.status);
            if (working === true) startTyping();
            else if (working === false) stopTyping();
            break;
          }
          case "session.idle": {
            const sessionID = props.sessionID ?? info?.sessionID;
            if (isChild(sessionID)) break;
            stopTyping();
            await onActiveSession(sessionID);
            await postResponse(sessionID);
            break;
          }
          case "session.error":
            stopTyping();
            break;
        }
      } catch (err) {
        await log("error", "event handler failed", { error: String(err) });
      }
    },
  };
};
