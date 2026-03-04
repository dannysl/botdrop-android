---
name: shizuku-automation
description: "Control Android apps via Shizuku Bridge. Use when: user asks to operate phone apps (open/close/switch), interact with screen (tap/swipe/type), take screenshots, inspect UI elements, or get device info. Requires BotDrop Android with Shizuku Bridge running."
---

# Shizuku Android Automation

Control Android device and apps through Shizuku Bridge from OpenClaw.

## Prerequisites

- BotDrop Android running with Shizuku authorized
- Bridge Server listening (check with `status` command)
- Config at `~/.openclaw/shizuku-bridge.json` (auto-written by BotDrop)

## Commands

All commands via: `node dist/cli.js <command> [args...]`

Rebuild from TypeScript:
```bash
npm install
npm run build
```

### Connection
```bash
node dist/cli.js help                           # Show all supported commands
node dist/cli.js status                          # Check Bridge + Shizuku status
```

### App Management
```bash
node dist/cli.js launch <package> [activity]     # Launch app (e.g. com.tencent.mm)
node dist/cli.js kill <package>                  # Force stop app
node dist/cli.js current-app                     # Get foreground app info
```

可选启动参数:
- `--post-launch-timeout-ms`
- `--post-launch-stable-cycles`
- `--post-launch-settle-ms`
- `--post-launch-transient-tolerance-ms`（新增：若目标包刚出现过且在该毫秒窗口内短暂掉前台，也视为成功）

### Screen Interaction
```bash
node dist/cli.js tap <x> <y>                     # Tap coordinates
node dist/cli.js tap-element '{"text":"Send"}'    # Find element by selector and tap
node dist/cli.js swipe <x1> <y1> <x2> <y2> [ms] # Swipe gesture
node dist/cli.js press <key>                     # Key press: home/back/enter/recent
```

### Text Input
```bash
node dist/cli.js type "Hello"                    # Auto-detect: ASCII → input text, Chinese → clipboard
```

### UI Inspection
```bash
node dist/cli.js ui-dump                         # Dump full UI tree
node dist/cli.js ui-dump --find '{"text":"OK"}'  # Dump + filter elements
node dist/cli.js wait-for '{"text":"OK"}' --timeout 10000  # Wait for element
```

### Screen Capture
```bash
node dist/cli.js screenshot                      # Screenshot → /data/local/tmp/botdrop_tmp/screenshots/shizuku-screenshot.png
node dist/cli.js screenshot --output /data/local/tmp/xxx.png   # Screenshot to specific path in /data/local/tmp
```

All local file operations (read-file/image-meta/image-to-base64/screenshot output resolution) are constrained to `/data/local/tmp/...` only.

### Device Info
```bash
node dist/cli.js device-info                     # Device model, Android version, etc.
```

### Raw Command
```bash
node dist/cli.js exec "dumpsys battery"          # Execute any shell command via Shizuku
```

## Selector Format

JSON object, fields combine with AND logic:

```json
{"text": "Send"}                     // exact text match
{"textContains": "Search"}           // text contains
{"resourceId": "com.xx:id/btn"}      // resource-id
{"className": "android.widget.Button"}
{"description": "Send button"}       // content-desc
{"text": "OK", "clickable": true}    // combined
```

## Output Format

All commands output JSON to stdout:
```json
{"ok": true, "data": {...}}
{"ok": false, "error": "BRIDGE_NOT_FOUND", "message": "Bridge config not found"}
```

## Practical Usage Guide

- Always start with `status`; do not skip this check after installation or a reboot.
- Keep one session doing one automation flow end-to-end. Repeated reconnect/restart cycles can cause unstable states.
- Before any sensitive action, run `current-app` to confirm the target app is in foreground.
- Use `ui-dump` first for deterministic UI control; use coordinates only when selectors are unavailable.
- For text input, first focus the input field with `tap-element`, then call `type`, so the string lands in the correct control.
- For transitions and dialogs, use short waits + checks:
  - `wait-for` for a target element/state
  - retry small actions instead of long fixed sleeps
- Coordinates in `tap`/`swipe` are device pixel values. Recalculate after screen size / density changes.
- If coordinate taps drift, switch to `tap-element` as the more stable option.
- All local file I/O and screenshot outputs should stay under `/data/local/tmp` (matching CLI constraints).
- If selector fails:
  - try `textContains` or `description` instead of exact `text`
  - relax constraints and include fewer required fields
- If `wait-for` still times out, extend `--timeout` only when the target app is actively loading.

### 稳定流程（推荐）

- 强制按顺序执行：
  1. `status`
  2. `launch <package>`
  3. `current-app`（确认前台是目标应用）
  4. `ui-dump --find` 读取目标页核心结构
  5. `wait-for` 目标控件或状态
  6. `tap-element` 执行交互
- 对“新手模式/消息中心”等高概率有遮挡动画的场景，建议只做上述最短动作链，不直接点击可疑子页面入口。
- 遇到跳转异常（回退到上一页/消息页）时，先 `current-app` + `ui-dump` 再决定下一步，不要盲目重复 launch。

### UI First, Screenshot Fallback

- Preferred flow:
  1. `ui-dump --find` with the target selector.
  2. If not found, call `wait-for` with a short timeout and retry.
  3. Re-run `ui-dump --find` with broader conditions (`textContains`, `description`, fewer fields).
  4. Use `tap-element` once a stable selector is identified.
  5. Use `screenshot` only when the UI tree is not enough to find a reliable selector.
- Screenshot should be treated as final fallback, mainly for:
  - visually inspecting blocked/animated overlays
  - confirming layout mismatches before switching to coordinate-based interactions
  - collecting evidence when selector-based automation cannot proceed
- `tap-element` 异常（如 `ELEMENT_NO_BOUNDS`）时：
  - 不要直接改为坐标点击（除非经过 page-level dump 证实目标已稳定可坐标）
  - 先 `ui-dump` 看目标 selector 是否能定位到更稳定的同类控件（`resourceId`、`className`、`textContains`）
  - 再通过更少字段的 selector 重试

## Common Workflows

**Open an app and take screenshot:**
```bash
node dist/cli.js launch com.tencent.mm
sleep 2
node dist/cli.js screenshot
```

**Find and tap a button:**
```bash
node dist/cli.js tap-element '{"text":"Send"}'
```

**Type into a field:**
```bash
node dist/cli.js tap-element '{"resourceId":"com.xx:id/input"}'
node dist/cli.js type "hello"
```

**Wait for page to load then act:**
```bash
node dist/cli.js wait-for '{"text":"Loaded"}' --timeout 15000
node dist/cli.js tap-element '{"text":"Next"}'
```

### Error Recovery Example

```bash
node dist/cli.js ui-dump --find '{"text":"OK"}'        # confirm target UI state
node dist/cli.js wait-for '{"text":"OK"}' --timeout 8000 # wait for confirmation text
node dist/cli.js tap-element '{"text":"Confirm"}'      # continue once visible

# Fallback only if selector remains unavailable
node dist/cli.js screenshot --output /data/local/tmp/fallback.png
```

## Error Codes

- `BRIDGE_NOT_FOUND` — `~/.openclaw/shizuku-bridge.json` missing, Bridge not running
- `BRIDGE_UNREACHABLE` — Bridge port not responding
- `SHIZUKU_NOT_READY` — Bridge up but Shizuku not authorized
- `EXEC_FAILED` — Command execution failed
- `ELEMENT_NOT_FOUND` — UI element matching selector not found
- `TIMEOUT` — Operation timed out

## Additional English Notes

### Reliable startup steps
- Run `status` before every automation flow to verify Bridge and Shizuku health.
- Run all related actions in one continuous session after authentication succeeds.
- Use `current-app` before sensitive actions to confirm the foreground app.

### UI interaction tips
- Use `ui-dump --find` first, then `tap-element`, to avoid blind taps.
- Focus the input control with `tap-element` before calling `type`.
- Prefer short retries over fixed long sleeps during transitions and dialogs.

### Coordinates and resolution tips
- `tap` and `swipe` coordinates use raw pixel units of the current display.
- Use `ui-dump` and the element `bounds` field to derive reliable coordinates.
- If coordinate input is unstable, prefer `tap-element` instead.

### Failure troubleshooting
- `ELEMENT_NOT_FOUND`: the UI may not have refreshed; run `wait-for` and retry.
- `TIMEOUT`: check whether the app is still loading; increase `--timeout` only when necessary.
- `EXEC_FAILED`: usually invalid arguments, bad JSON escaping, or permission/path issues.

### File and screenshot constraints
- Keep screenshot and local file operations under `/data/local/tmp` per CLI restrictions.
- For image post-processing, write to `--output` first, then consume from the allowed directory path.
