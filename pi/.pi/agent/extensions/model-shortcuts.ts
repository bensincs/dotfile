import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir, type ExtensionAPI } from "@earendil-works/pi-coding-agent";

const digits = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"] as const;

type ModelShortcut = {
  provider: string;
  model: string;
  thinkingLevel: Parameters<ExtensionAPI["setThinkingLevel"]>[0];
};

export default function (pi: ExtensionAPI) {
  // Edit the JSON and run /reload to update bindings and /hotkeys descriptions.
  const shortcuts = JSON.parse(
    readFileSync(join(getAgentDir(), "model-shortcuts.json"), "utf8"),
  ) as Partial<Record<(typeof digits)[number], ModelShortcut | null>>;

  for (const digit of digits) {
    const shortcut = shortcuts[digit];
    if (!shortcut) continue;

    pi.registerShortcut(`super+${digit}`, {
      description: `Select ${shortcut.model} (${shortcut.thinkingLevel})`,
      handler: async (ctx) => {
        if (!ctx.isIdle()) {
          ctx.ui.notify("Wait for the current response or cancel it before switching models.", "warning");
          return;
        }

        const model = ctx.modelRegistry.find(shortcut.provider, shortcut.model);
        if (!model) {
          ctx.ui.notify(`Model not found: ${shortcut.provider}/${shortcut.model}`, "error");
          return;
        }
        if (!(await pi.setModel(model))) {
          ctx.ui.notify(`Sign in to ${shortcut.provider} with /login first.`, "warning");
          return;
        }

        // Pi clamps thinking to the selected model's supported levels.
        pi.setThinkingLevel(shortcut.thinkingLevel);
        ctx.ui.notify(`${model.name} (${pi.getThinkingLevel()})`, "info");
      },
    });
  }
}
