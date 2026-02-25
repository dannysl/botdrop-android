## v0.2.6

### New Features
- Added OpenClaw history version selection: quickly install or switch versions from the cached latest 20 stable releases.
- Added a new tabbed channel setup flow for Telegram, Discord, and Feishu in Step 4.

### Improvements
- Improved OpenClaw version loading reliability with 1-hour cache + offline fallback when fetching versions fails.
- Added stable-version filtering and deduplication for cleaner, safer release selection.
- Updated Dashboard/Launcher to recognize all three channels (Telegram, Discord, Feishu) consistently.

### Fixes
- Fixed Feishu setup-code decode/write path so Feishu configuration is now properly saved.
