---
name: shizuku-automation
description: "Control Android apps via Shizuku Bridge. Use when: user asks to operate phone apps (open/close/switch), interact with screen (tap/swipe/type), take screenshots, inspect UI elements, or get device info. Requires BotDrop Android with Shizuku Bridge running."
---

# Shizuku Android Automation

Control Android device and apps through Shizuku Bridge from OpenClaw.

This skill is intentionally generic: runtime code provides basic actions (tap/swipe/type/ui-dump/press/screenshot/wait), and app-specific flow decisions stay in LLM policy. Avoid app-level hardcoded branches.

## Prerequisites

- BotDrop Android running with Shizuku authorized
- Bridge Server listening (check with `status` command)
- Config at `~/.openclaw/shizuku-bridge.json` (auto-written by BotDrop)

## Commands

All commands via: `node dist/cli.js <command> [args...]`

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
node dist/cli.js dismiss-popups --rounds 2        # Clear common blocking dialogs
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
node dist/cli.js type "Hello"                    # Auto-detect: ASCII → input text, Chinese → adb-keyboard with post-send verification
node dist/cli.js type "Type your text" --focus-selector '{"textContains":"Type your text","className":"android.widget.TextView"}'
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
node dist/cli.js exec "back"                    # Back key via Shizuku (alias of input keyevent KEYCODE_BACK)
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

- Start with `status` and keep this as one continuous session.
- App launch baseline:
  - After `launch <package>`, immediately check `current-app` + `ui-dump`.
  - If the app is not on the expected start page, use `press back` repeatedly to return to app home.
  - After each `back`, re-sample `current-app` + `ui-dump` and only continue when home markers are present.
- Before each action:
  - 先抓一次 `current-app` 与当前 `activity`/`package`
  - 用 `ui-dump` 形成当前页签名
  - 决定动作后的期望变化（跳页、弹窗、局部刷新）
- 执行动作后立即复查：
  - `package` 是否变了
  - `activity` 是否变了
  - `transition` 中是否有 `uiFingerprintChanged`
  - 哪些 `可交互控件/输入控件` 出现或消失
  - 关注 `observeProfile`（`observeWaitMs` / `observePollMs` / `waitedMs` / `attempts`），避免误判固定等待
- 在这个变更摘要的基础上由 LLM 决定下一步重试、换策略或结束流程。
  - 输出会带 `state_before / state_after / transition / suggestion`
    - `state_after.ui.summary.interactiveNodes` 每条记录新增 `nodeId`（如 `n:57`），可让 LLM 在同一页稳定引用控件
    - `observeProfile`: 采样窗口与实际等待结果
    - `visualFallback`: 互动动作无变化时自动补抓截图（`ok/path/command`；失败含 `error`）；可用 `--no-visual-fallback` 关闭
    - `state_before`, `state_after`: 页面快照（package/activity/ui 统计）
    - `transition`: 变化摘要（activity变更、activity是否变更、ui hash 变更、增删控件）
    - `state_after.ui.summary.interactiveNodes`: 当前页重点交互控件列表（可用于判断是否卡在弹窗/按钮区）
    - `suggestion`: LLM 可直接消费的下一步建议
- `ui-dump` 仍然是第一选择；坐标仅用于 selector 不可用时的备选。
- 文字输入默认保持 `type` 先聚焦（自动识别可编辑控件/占位文案）再输入，再在动作后验证页面是否已变更。需要关闭可用 `--no-focus`；必要时可显式传 `--focus-selector '<selector>'` 精准点击。
- 异常时先 `dismiss-popups`，再返回上一轮差分结果重做决策（不要继续执行固定列表）。
- Coordinates in `tap`/`swipe` are device pixel values. Recalculate after screen size / density changes.
- If coordinate taps drift, switch to `tap-element` as the more stable option.
- All local file I/O and screenshot outputs should stay under `/data/local/tmp` (matching CLI constraints).
- If selector fails:
  - try `textContains` or `description` instead of exact `text`
  - relax constraints and include fewer required fields
- If `wait-for` still times out, extend `--timeout` only when the target app is actively loading.

### 动态决策规则（按状态驱动）

- 每条动作必须有 `state_before -> action -> state_after -> transition`，再由 LLM 决策下一步。
- 不要在 SKILL 内写固定的“流程步骤列表”；只有动作结果驱动下一条命令。
- `ok:false` 也要继续决策：优先看 `transition` 与 `suggestion`，而不是直接报错重试同一条命令。

### 特殊场景（供 LLM 决策）

- 对以下情况不做固定路径，全部交给 LLM 重判并输出下一条命令：
  - 回退/返回后只出现按钮文案变动但无页面级跳转（`activityChanged=false` 且 `packageChanged=false`）；
  - 出现“临时提示框/确认提示/未保存提示”等中间提示文本；
  - 点击/输入后 `transition.changed=false` 且目标 selector 仍在旧页；
  - 弹窗/遮罩可能拦截点击（popup-like 控件出现/消失不稳定）。
- 常见处理顺序：
  1. `current-app` -> `ui-dump`，确认真实上下文；
  2. `dismiss-popups` 清理阻塞层；
  3. 基于 `state_after.ui.summary.interactiveNodes` 重新选择下一条命令（通常是 `press back`/`tap-element`/`type` 重试策略）。

### 动态响应示例（给 LLM）

```json
{
  "ok": true,
  "data": {
    "ok": true,
    "x": 586,
    "y": 2675,
    "state_before": {
      "packageName": "com.example.app",
      "activity": "com.example.app/.MainActivity",
      "raw": "...",
      "timestampMs": 1700000000000,
      "ui": {
        "available": true,
        "summary": {
          "totalElements": 220,
          "interactiveCount": 38,
          "editableCount": 0,
          "fingerprint": "220:1a2b3c"
        }
      }
    },
    "state_after": {
      "packageName": "com.example.app",
      "activity": "com.example.app/.MainActivity",
      "raw": "...",
      "timestampMs": 1700000000500,
      "ui": {
        "available": true,
        "summary": {
          "totalElements": 244,
          "interactiveCount": 42,
          "editableCount": 0,
          "fingerprint": "244:9f0e1a"
        }
      }
    },
    "transition": {
      "changed": true,
      "activityChanged": false,
      "packageChanged": false,
      "appRawChanged": true,
      "beforeUiAvailable": true,
      "afterUiAvailable": true,
      "uiFingerprintChanged": true,
      "uiElementCountDelta": 24,
      "interactiveCountDelta": 4,
      "editableCountDelta": 0,
      "added": [
        {
          "nodeId": "n:142",
          "signature": "...",
          "text": "写文字",
          "description": "",
          "className": "android.widget.TextView",
          "resourceId": "android:id/text1",
          "bounds": "500,2600,680,2720",
          "clickable": true,
          "focusable": true,
          "enabled": true
        }
      ],
      "removed": []
    },
    "observeProfile": {
      "timedOut": false,
      "observeWaitMs": 420,
      "observePollMs": 120,
      "waitedMs": 140,
      "attempts": 2
    },
    "visualFallback": null,
    "suggestion": {
      "needsAttention": false,
      "reasons": [
        "page activity changed, continue in new page context"
      ],
      "suggest": []
    }
  }
}
```

无变化兜底示例：
```json
{
  "ok": true,
  "data": {
    "ok": true,
    "x": 586,
    "y": 2675,
    "state_before": {
      "packageName": "com.example.app",
      "activity": "com.example.app/.MainActivity",
      "raw": "...",
      "timestampMs": 1700000000000,
      "ui": {
        "available": true,
        "summary": {
          "totalElements": 220,
          "interactiveCount": 38,
          "editableCount": 0,
          "fingerprint": "220:1a2b3c"
        }
      }
    },
    "state_after": {
      "packageName": "com.example.app",
      "activity": "com.example.app/.MainActivity",
      "raw": "...",
      "timestampMs": 1700000000500,
      "ui": {
        "available": true,
        "summary": {
          "totalElements": 220,
          "interactiveCount": 38,
          "editableCount": 0,
          "fingerprint": "220:1a2b3c"
        }
      }
    },
    "transition": {
      "changed": false,
      "activityChanged": false,
      "packageChanged": false,
      "appRawChanged": false,
      "beforePopupCandidatesCount": 0,
      "afterPopupCandidatesCount": 0,
      "beforeUiAvailable": true,
      "afterUiAvailable": true,
      "uiFingerprintChanged": false,
      "uiElementCountDelta": 0,
      "interactiveCountDelta": 0,
      "editableCountDelta": 0,
      "added": [
        {
          "nodeId": "n:142",
          "signature": "...",
          "text": "重试",
          "description": "",
          "className": "android.widget.Button",
          "resourceId": "com.example.app:id/retry",
          "bounds": "500,2600,680,2720",
          "clickable": true,
          "focusable": true,
          "enabled": true
        }
      ],
      "removed": []
    },
    "observeProfile": {
      "timedOut": true,
      "observeWaitMs": 420,
      "observePollMs": 120,
      "waitedMs": 420,
      "attempts": 4
    },
    "visualFallback": {
      "ok": true,
      "path": "/data/local/tmp/botdrop_tmp/screenshots/shizuku-visual-fallback-1700000000500.png",
      "androidPath": "/data/local/tmp/botdrop_tmp/screenshots/shizuku-visual-fallback-1700000000500.png",
      "requestedPath": "/data/local/tmp/botdrop_tmp/screenshots/shizuku-visual-fallback-1700000000500.png",
      "capturedAtMs": 1700000000500,
      "command": "tap",
      "reason": "No UI transition detected after tap within 420ms"
    },
    "suggestion": {
      "needsAttention": true,
      "reasons": [
        "no UI transition detected",
        "popup-like controls detected: 关闭 / 取消 / 暂不",
        "visualFallback captured: /data/local/tmp/botdrop_tmp/screenshots/shizuku-visual-fallback-1700000000500.png"
      ],
      "suggest": [
        {"command": "dismiss-popups", "reason": "try clear potential blocking dialog/overlay"},
        {"command": "ui-dump", "reason": "re-read tree and verify target selector availability"}
      ]
    }
  }
}
```

消费规则：
- 如果 `transition.activityChanged` 或 `packageChanged`：继续新页流程。
- 如果 `transition.changed = false`：先 `dismiss-popups`，再重试动作或改 selector。
- 如果 `suggestion.reasons` 里出现 `popup-like controls detected`：直接查看 `state_after.ui.summary.interactiveNodes` 中的按钮文本，优先处理 `取消/关闭/暂不/稍后` 等弹窗动作。
- 对 `tap-element`：若 `transition.changed = false` 且目标 selector 在当前页面仍存在，判定为“未命中”；建议 `dismiss-popups` 后直接重试同一 selector。
- 如果 `suggestion.needsAttention = true`：按 `suggestion.suggest` 里的命令推进。

### 给 LLM 的决策规则（可直接作为内部提示）

每次动作后，只读以下字段，不要假设未出现的字段变化：
1. `state_before` / `state_after`
2. `transition`
3. `transition.suggestion`

决策优先级：
- 优先级 A（必须执行）：
  - `transition.packageChanged === true`：先 `current-app`，确认是否切走了目标 app；若回到目标以外，先修正入口。
  - `transition.activityChanged === true`：更新上下文为新页面，只在新页面上继续找目标控件。
- 优先级 B（当前动作失效）：
  - `transition.changed === false`：立即执行 `dismiss-popups`，再重试同一动作一次；若仍失败，调整 selector。
  - `tap-element` 且 `transition.changed === false` 且目标 selector 仍在：判定为坐标/命中失败，不推进到下一步骤，立即重试点击。
  - `suggestion.needsAttention === true`：执行 `suggestion.suggest` 中的首条命令（通常是 `dismiss-popups` 或 `current-app`）。
- 优先级 C（继续推进）：
  - `transition.uiFingerprintChanged === true` 且 `activityChanged === false`：说明在当前页有局部刷新，继续按目标控件命中策略前进。
- 输出要求（给模型的动作决策）：
  - 只返回下一步动作（command + args + optional flags）+ 1 句简短原因。
  - 下一步必须基于 `added/removed` 中可见可交互控件更新 selector，不要照搬上一步 selector。

### 稳定任务节奏（推荐）

- 只保留“动作-快照-差分-决策”循环，不要写死固定路线。
- 推荐最小循环：
  1. `current-app` + `ui-dump`
  2. 执行一个动作：`tap-element` / `swipe` / `press` / `type`
  3. 读取返回的 `transition`（或再次 `current-app` + `ui-dump`）
  4. LLM 根据 `transition` 决定下一步：
     - 页面已跳转：继续在新页查找目标入口
     - 仅局部变化：重试/补齐控件定位
     - 无变化或弹窗：先 `dismiss-popups` 再重试或换备选策略
- 遇到跳转异常（回退到旧页/消息页）时，不要重启流程；直接以当前差分为依据重规划下一步。

### UI First, Screenshot Fallback

- 自适应决策循环（不固定顺序）:
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
