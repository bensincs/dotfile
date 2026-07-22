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

const ROOT = path.join(
  process.env.XDG_STATE_HOME || path.join(os.homedir(), ".local", "state"),
  "opencode-telegram",
);
const WINDOWS_DIR = path.join(ROOT, "windows"); // <pid>.json -> {pid,threadId,chatId}
const INBOX_DIR = path.join(ROOT, "inbox"); // <pid>.jsonl -> queued incoming
const LOCK_FILE = path.join(ROOT, "poller.lock");
const OFFSET_FILE = path.join(ROOT, "offset.json");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function truncate(text, max = TG_LIMIT) {
  if (typeof text !== "string") return "";
  if (text.length <= max) return text;
  return text.slice(0, max - 16).trimEnd() + "\n…(truncated)";
}

// Convert a *very small* subset of Markdown to Telegram-safe HTML.
// This is intentionally conservative: handle code blocks, inline code,
// links, bold and italic, and escape HTML. It uses placeholders for code
// regions so formatting inside code isn't mangled.
// Use markdown-it to render markdown to an HTML subset compatible with Telegram's
// HTML parse_mode. We disable raw HTML in source and customize the renderer to
// emit only tags supported by Telegram: <b>, <i>, <a>, <code>, <pre>.
function mdToHtml(mdText) {
  if (typeof mdText !== "string") return "";
  const md = new MarkdownIt({ html: false, linkify: true });

  // Override renderer rules to emit Telegram-friendly HTML only.
  const r = md.renderer.rules;

  r.paragraph_open = () => "";
  r.paragraph_close = () => "\n\n";
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

  return md.render(mdText).trim();
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
    const html = mdToHtml(truncate(text));
    const payload = {
      chat_id: groupId,
      message_thread_id: tid,
      text: prefix + html,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    };
    // If TELEGRAM_DISABLE_NOTIFICATIONS is set to "1" then mark as silent.
    if (process.env.TELEGRAM_DISABLE_NOTIFICATIONS === "1") payload.disable_notification = true;
    await tg(token, "sendMessage", payload);
  }

  // ---- "typing…" indicator while the assistant is replying -----------------
  // Telegram's chat action lasts ~5s, so re-send it on an interval until idle.
  let typingTimer = null;
  let typingStart = 0;
  async function sendTyping() {
    const tid = await ensureTopic();
    if (!tid) return;
    await tg(token, "sendChatAction", {
      chat_id: groupId,
      message_thread_id: tid,
      action: "typing",
    });
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
