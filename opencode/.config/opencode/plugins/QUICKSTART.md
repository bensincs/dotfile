# OpenCode Notification Plugin - Quick Start

## ✅ Installation Complete!

You now have a fully functional OpenCode plugin that sends desktop notifications.

## What You Have

### 1. Terminal Notifier
- ✅ Installed via Homebrew
- ✅ Added to Brewfile for future installs

### 2. OpenCode Plugin
- ✅ Located at `~/.config/opencode/plugins/notification.ts`
- ✅ Automatically loaded by OpenCode
- ✅ TypeScript with full type support

## How It Works

The plugin automatically sends notifications when:

1. **Task Completes** → Success notification with duration
   ```
   OpenCode ✓
   Task completed in 42s
   ```

2. **Error Occurs** → Error notification with details
   ```
   OpenCode ✗
   Error message here
   Check the session for details
   ```

## No Configuration Needed!

The plugin works automatically. Just use OpenCode normally:

```bash
cd your-project
opencode
```

When tasks complete or errors occur, you'll get desktop notifications! 🔔

## Testing It

1. **Start OpenCode** in any project
2. **Ask it to do something** (e.g., "explain this file")
3. **Wait for it to finish**
4. **You'll get a notification!**

## Files

```
~/.config/opencode/plugins/
├── notification.ts      # Main plugin
├── package.json         # Dependencies  
├── tsconfig.json        # TypeScript config
└── README.md            # Full documentation
```

## Customization

Edit `~/.config/opencode/plugins/notification.ts` to:
- Change notification sounds
- Add more event types
- Adjust timing thresholds
- Integrate with other tools

See the README.md for full customization options!

## Need Help?

- Read the [full README](./README.md)
- Check [OpenCode plugin docs](https://opencode.ai/docs/plugins)
- Test manually: `terminal-notifier -title "Test" -message "Hello"`

Enjoy your notifications! 🎉
