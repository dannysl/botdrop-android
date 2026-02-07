# Contributing to BotDrop

Thanks for your interest in contributing!

## Development Setup

1. Clone the repo
2. Open in Android Studio (or build with `./gradlew assembleDebug`)
3. Requires JDK 17+ and Android SDK/NDK

## Code Style

- Java, following existing project conventions
- No Kotlin files (keeping consistency with Termux base)
- Keep BotDrop-specific code in `app/src/main/java/app/botdrop/`
- Termux core code in `com.termux.*` — modify only when necessary

## Pull Requests

1. Fork the repo and create a feature branch
2. Make your changes with clear commit messages
3. Ensure `./gradlew assembleDebug` passes
4. Run tests: `./gradlew :app:testDebugUnitTest`
5. Submit a PR with a clear description

## Reporting Issues

Use the [issue templates](.github/ISSUE_TEMPLATE/) for bug reports and feature requests.

## License

By contributing, you agree that your contributions will be licensed under GPLv3.
