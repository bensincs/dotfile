# OpenCode Notification Plugin

Desktop notifications for OpenCode using `terminal-notifier`.

## Features

This plugin automatically sends macOS notifications when:

- ✓ **Sessions complete** - Get notified when OpenCode finishes a task
- ✗ **Errors occur** - Immediate alerts when something goes wrong
- ⏱️ **Duration tracking** - See how long tasks took to complete

## Installation

The plugin is automatically loaded from `~/.config/opencode/plugins/notification.ts`.

Make sure `terminal-notifier` is installed:

```bash
brew install terminal-notifier
```

## How It Works

The plugin hooks into OpenCode's event system:

### Session Idle (Task Complete)
When a session becomes idle after completing work:
- Tracks how long the task took
- Sends a success notification with duration
- Plays a pleasant "Glass" sound

### Session Error
When an error occurs:
- Captures the error message
- Sends an error notification
- Plays an alert "Basso" sound

## Notification Examples

**Success:**
```
Title: OpenCode ✓
Message: Task completed in 42s
Sound: Glass (pleasant chime)
```

**Error:**
```
Title: OpenCode ✗
Message: Error message here
Subtitle: Check the session for details
Sound: Basso (alert sound)
```

## Configuration

The plugin works automatically once installed. No configuration needed!

### Customization

To customize the plugin, edit `~/.config/opencode/plugins/notification.ts`:

```typescript
// Change notification sounds
await $`terminal-notifier -title "OpenCode ✓" -message "Done!" -sound "Ping"`;

// Add custom events
if (event.type === "file.edited") {
  await $`terminal-notifier -title "File Saved" -message "Changes saved"`;
}

// Adjust duration threshold (only notify for long tasks)
if (duration > 30) { // Only notify if >30 seconds
  await $`terminal-notifier ...`;
}
```

## Available Sounds

- `Glass` - Success (default for completions)
- `Basso` - Error (default for errors)
- `Ping` - Notification
- `Pop` - Alert
- `Purr` - Gentle notification
- `default` - System default

See `/System/Library/Sounds/` for all available sounds.

## Troubleshooting

### Notifications not appearing?

1. Check if terminal-notifier is installed:
   ```bash
   which terminal-notifier
   ```

2. Test manually:
   ```bash
   terminal-notifier -title "Test" -message "Hello" -sound "Glass"
   ```

3. Check notification permissions in System Settings → Notifications

### Want to disable?

Simply remove or rename the plugin file:
```bash
mv ~/.config/opencode/plugins/notification.ts ~/.config/opencode/plugins/notification.ts.disabled
```

## Advanced Usage

### Add More Event Types

The plugin can hook into any OpenCode event. See the [plugin documentation](https://opencode.ai/docs/plugins) for all available events.

Example - notify on file edits:

```typescript
event: async ({ event }) => {
  if (event.type === "file.edited") {
    await $`terminal-notifier -title "OpenCode" -message "File edited: ${event.data.path}"`;
  }
}
```

### Integration with Other Tools

You can extend the plugin to integrate with other notification systems:

```typescript
// Slack webhook
await fetch('https://hooks.slack.com/...', {
  method: 'POST',
  body: JSON.stringify({ text: 'Task completed!' })
});

// Custom webhook
await $`curl -X POST https://your-api.com/notify`;
```

## Files

- `notification.ts` - Main plugin implementation
- `package.json` - Plugin dependencies
- `tsconfig.json` - TypeScript configuration

## License

MIT
