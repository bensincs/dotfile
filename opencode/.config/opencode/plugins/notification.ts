import type { Plugin } from "@opencode-ai/plugin";

/**
 * OpenCode Notification Plugin
 * 
 * Automatically sends desktop notifications when:
 * - Sessions become idle (task completed)
 * - Sessions encounter errors
 * - Long-running operations complete
 */
export const NotificationPlugin: Plugin = async ({ project, client, $, directory, worktree }) => {
  // Track session start time for duration calculations
  let sessionStartTime: number | null = null;

  return {
    event: async ({ event }) => {
      try {
        // Session started/updated - track timing
        if (event.type === "session.created" || event.type === "session.updated") {
          if (!sessionStartTime) {
            sessionStartTime = Date.now();
          }
        }

        // Session completed successfully
        if (event.type === "session.idle" && sessionStartTime) {
          const duration = Math.round((Date.now() - sessionStartTime) / 1000);
          
          await $`terminal-notifier -title "OpenCode" -message "Task completed in ${duration}s" -sound "Glass" -appIcon "$HOME/.config/opencode/plugins/icons/vscode.icns"`;
          
          sessionStartTime = null;
        }

        // Session encountered an error
        if (event.type === "session.error") {
          const errorMessage = event.data?.message || "An error occurred";
          
          await $`terminal-notifier -title "OpenCode Error" -message ${errorMessage} -subtitle "Check the session for details" -sound "Basso" -appIcon "$HOME/.config/opencode/plugins/icons/vscode.icns"`;
          
          sessionStartTime = null;
        }

        // Log events for debugging (optional)
        await client.app.log({
          service: "notification-plugin",
          level: "debug",
          message: `Event: ${event.type}`,
        });

      } catch (error) {
        // Silently fail if terminal-notifier isn't available
        await client.app.log({
          service: "notification-plugin",
          level: "warn",
          message: "Failed to send notification",
          extra: { error: String(error) },
        });
      }
    },
  };
};
