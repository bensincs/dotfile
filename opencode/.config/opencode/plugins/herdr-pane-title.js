// Custom herdr integration (not managed by herdr): reports the current
// opencode session title to the pane so herdr's sidebar shows what each pane
// is working on (e.g. "Refactor auth middleware") instead of a generic label.
// It sets both the pane title and the displayed agent name to the session
// title, and updates when you switch to or resume a different session.
//
// Uses pane.report_metadata, which is display-only and does not touch the
// semantic agent state owned by the official herdr-agent-state.js plugin.

import net from "node:net";

const SOURCE = "user:opencode-title";
const AGENT = "opencode";
let reportSeq = Date.now() * 1000;

// Subagent (task tool) sessions carry a parentID. Their titles would clobber
// the pane's real title, so we skip any session that has a parent.
const childSessions = new Set();
// Avoid redundant socket writes when the visible title has not changed.
let lastTitle;

function nextReportSeq() {
  reportSeq += 1;
  return reportSeq;
}

function request(method, params) {
  const paneId = process.env.HERDR_PANE_ID;
  const socketPath = process.env.HERDR_SOCKET_PATH;

  if (!paneId || !socketPath) {
    return Promise.resolve();
  }

  const requestId = `${SOURCE}:${Date.now()}:${Math.floor(Math.random() * 1_000_000)
    .toString()
    .padStart(6, "0")}`;
  const payload = {
    id: requestId,
    method,
    params: {
      pane_id: paneId,
      source: SOURCE,
      agent: AGENT,
      seq: nextReportSeq(),
      ...params,
    },
  };

  return new Promise((resolve) => {
    const client = net.createConnection(socketPath, () => {
      client.write(`${JSON.stringify(payload)}\n`);
    });

    const finish = () => {
      client.destroy();
      resolve();
    };

    client.setTimeout(500, finish);
    client.on("data", finish);
    client.on("error", finish);
    client.on("end", finish);
    client.on("close", resolve);
  });
}

function reportTitle(title) {
  const normalized = typeof title === "string" ? title.trim() : "";
  if (!normalized || normalized === lastTitle) {
    return Promise.resolve();
  }
  lastTitle = normalized;
  // Set both the pane title and the displayed agent name to the session title.
  return request("pane.report_metadata", {
    title: normalized,
    display_agent: normalized,
  });
}

export const HerdrPaneTitlePlugin = async ({ client }) => {
  if (
    process.env.HERDR_ENV !== "1" ||
    !process.env.HERDR_SOCKET_PATH ||
    !process.env.HERDR_PANE_ID
  ) {
    return {};
  }

  // Look up a session's current title via the opencode client and report it,
  // unless it is a subagent (child) session.
  async function reportBySessionID(sessionID) {
    if (!sessionID || childSessions.has(sessionID)) {
      return;
    }
    try {
      const res = await client.session.get({ path: { id: sessionID } });
      const session = res?.data;
      if (!session || session.parentID) {
        if (session?.parentID) childSessions.add(sessionID);
        return;
      }
      await reportTitle(session.title);
    } catch {
      // best-effort; ignore lookup failures
    }
  }

  return {
    event: async ({ event }) => {
      const type = event?.type;
      const properties = event?.properties ?? {};
      const info = properties.info;

      // Track subagent sessions so we can ignore their titles everywhere.
      if (info?.id && info.parentID) {
        childSessions.add(info.id);
      }

      const sessionID =
        typeof properties.sessionID === "string" ? properties.sessionID : info?.id;

      switch (type) {
        // These carry the session object directly, including the title.
        case "session.created":
        case "session.updated":
          if (info && !info.parentID && typeof info.title === "string") {
            await reportTitle(info.title);
          }
          break;
        // These only carry a sessionID; fetch the title. This is what makes
        // switching to / resuming an existing session update the pane once you
        // interact with it (message, status change, or the agent going idle).
        case "message.updated":
        case "session.status":
        case "session.idle":
        case "session.compacted":
          await reportBySessionID(sessionID);
          break;
        default:
          break;
      }
    },
    // Fires whenever a message is sent in a session — the most reliable signal
    // that a given (possibly resumed) session is the active one.
    "chat.message": async ({ sessionID }) => {
      await reportBySessionID(sessionID);
    },
  };
};
