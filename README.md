# BotDrop

Run AI agents on your Android phone — no terminal required.

BotDrop wraps [OpenClaw](https://openclaw.ai) into a guided mobile experience. Install, configure, and manage your AI agent in 4 simple steps.

## Features

- **4-step guided setup** — Auth, Agent Selection, Install, Channel Connection
- **Multi-provider support** — Anthropic, OpenAI, Google Gemini, OpenRouter, and more
- **Telegram & Discord integration** — Chat with your agent through your favorite messenger
- **Background operation** — Gateway runs as a foreground service with auto-restart
- **Zero CLI knowledge needed** — Everything happens through the GUI

## Screenshots

<!-- TODO: Add screenshots -->

## Getting Started

### Download

Get the latest APK from [Releases](../../releases).

### Build from Source

**Requirements:** Android SDK, NDK, JDK 17+

```bash
git clone https://github.com/louzhixian/botdrop-android.git
cd botdrop-android
./gradlew assembleDebug
```

The APK will be at `app/build/outputs/apk/debug/`.

## Architecture

BotDrop is built on [Termux](https://github.com/termux/termux-app), providing a Linux environment for running Node.js-based AI agents.

```
+-----------------------------+
|  BotDrop UI (app.botdrop)   |
|  Setup - Dashboard - Config |
+-----------------------------+
|  Termux Core (com.termux)   |
|  Shell - Bootstrap - Env    |
+-----------------------------+
|  Linux Environment          |
|  Node.js - OpenClaw - SSH   |
+-----------------------------+
```

See [docs/design.md](docs/design.md) for detailed architecture documentation.

## Contributing

Contributions are welcome! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

This project is licensed under the GNU General Public License v3.0 — see [LICENSE](LICENSE) for details.

Built on [Termux](https://github.com/termux/termux-app) (GPLv3).

## Credits

- [Termux](https://github.com/termux/termux-app) — Terminal emulator for Android
- [OpenClaw](https://openclaw.ai) — AI agent framework
