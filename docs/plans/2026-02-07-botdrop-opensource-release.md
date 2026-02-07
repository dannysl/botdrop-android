# BotDrop Open-Source Release Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Prepare BotDrop for open-source release: rename from Owlia, restyle UI to match botdrop.app, add tests, and create standard open-source files.

**Architecture:** Three sequential phases — rename/repackage first (foundation), then UI (visual polish), then open-source readiness (tests, docs, cleanup). All work in worktree `.worktrees/opensource-release/` on branch `feature/opensource-release`.

**Tech Stack:** Android (Java), Gradle, AndroidX, Material Design

**Worktree:** `/Users/zhixian/Codes/owlia-android/.worktrees/opensource-release/`

**Logo Assets:** `/Users/zhixian/Desktop/botdrop-assets/` (app-logo.png 728x728, agent-openclaw.png 256x256, agent-owliabot.png 256x256)

---

## Phase 1: Rename / Repackage

### Task 1: Move Java package directory

Move the owlia package directory to botdrop. This is a file-system move, not content change.

**Files:**
- Move: `app/src/main/java/com/termux/app/owlia/` → `app/src/main/java/app/botdrop/`

**Step 1: Create new package directory**

```bash
mkdir -p app/src/main/java/app/botdrop
```

**Step 2: Move all Java files**

```bash
mv app/src/main/java/com/termux/app/owlia/*.java app/src/main/java/app/botdrop/
```

**Step 3: Remove old directory**

```bash
rmdir app/src/main/java/com/termux/app/owlia
```

**Step 4: Commit**

```bash
git add -A && git commit -m "refactor: move owlia package to app.botdrop"
```

---

### Task 2: Rename classes and update package declarations

Rename Owlia-prefixed classes and update all package/import declarations in the moved files.

**Files:**
- Rename: `app/src/main/java/app/botdrop/OwliaService.java` → `BotDropService.java`
- Rename: `app/src/main/java/app/botdrop/OwliaConfig.java` → `BotDropConfig.java`
- Rename: `app/src/main/java/app/botdrop/OwliaLauncherActivity.java` → `BotDropLauncherActivity.java`
- Modify: All 13 files in `app/src/main/java/app/botdrop/`

**Step 1: Rename the three Owlia-prefixed files**

```bash
cd app/src/main/java/app/botdrop
mv OwliaService.java BotDropService.java
mv OwliaConfig.java BotDropConfig.java
mv OwliaLauncherActivity.java BotDropLauncherActivity.java
```

**Step 2: Update package declarations in all 13 files**

In every `.java` file in `app/src/main/java/app/botdrop/`:
- Replace `package com.termux.app.owlia;` → `package app.botdrop;`

**Step 3: Update class name references within the package**

In all files in `app/src/main/java/app/botdrop/`:
- Replace `OwliaService` → `BotDropService` (class name, field names like `mOwliaService`, method calls)
- Replace `OwliaConfig` → `BotDropConfig`
- Replace `OwliaLauncherActivity` → `BotDropLauncherActivity`

**Step 4: Update import statements within the package**

Some files import other owlia classes. Update:
- `import com.termux.app.owlia.OwliaService;` → `import app.botdrop.BotDropService;`
- `import com.termux.app.owlia.OwliaConfig;` → `import app.botdrop.BotDropConfig;`
- etc.

**Step 5: Commit**

```bash
git add -A && git commit -m "refactor: rename Owlia classes to BotDrop, update package to app.botdrop"
```

---

### Task 3: Update Termux core references to owlia package

Termux core code references the owlia package. Update these imports and references.

**Files:**
- Modify: `app/src/main/java/com/termux/app/TermuxActivity.java`
  - Line ~191: `CONTEXT_MENU_OWLIA_DASHBOARD_ID` → `CONTEXT_MENU_BOTDROP_DASHBOARD_ID`
  - Line ~652: Menu item reference
  - Lines ~703-704: Intent to `com.termux.app.owlia.OwliaLauncherActivity` → `app.botdrop.BotDropLauncherActivity`
- Modify: `termux-shared/src/main/java/com/termux/shared/termux/TermuxConstants.java`
  - Line ~350: `TERMUX_APP_NAME = "Owlia"` → `TERMUX_APP_NAME = "BotDrop"` (verify not already changed)

**Step 1: Update TermuxActivity.java**

- Rename constant `CONTEXT_MENU_OWLIA_DASHBOARD_ID` → `CONTEXT_MENU_BOTDROP_DASHBOARD_ID`
- Update import from `com.termux.app.owlia.OwliaLauncherActivity` → `app.botdrop.BotDropLauncherActivity`
- Update all references to the old class/constant names
- Update any menu item labels from "Owlia" to "BotDrop"

**Step 2: Update TermuxConstants.java if needed**

- Check if `TERMUX_APP_NAME` is still "Owlia" — if so, change to "BotDrop"
- Search for any other owlia/Owlia references

**Step 3: Search entire codebase for remaining owlia references in Java files**

```bash
grep -rn -i "owlia" app/src/main/java/com/termux/ termux-shared/src/main/java/
```

Fix any remaining references found.

**Step 4: Commit**

```bash
git add -A && git commit -m "refactor: update Termux core references from Owlia to BotDrop"
```

---

### Task 4: Update AndroidManifest.xml

Update activity, service, and receiver declarations to use new package path.

**Files:**
- Modify: `app/src/main/AndroidManifest.xml`

**Step 1: Update component declarations**

Replace all `.app.owlia.` references:
- `.app.owlia.OwliaLauncherActivity` → `app.botdrop.BotDropLauncherActivity`
- `.app.owlia.SetupActivity` → `app.botdrop.SetupActivity`
- `.app.owlia.DashboardActivity` → `app.botdrop.DashboardActivity`
- `.app.owlia.OwliaService` → `app.botdrop.BotDropService`
- `.app.owlia.GatewayMonitorService` → `app.botdrop.GatewayMonitorService`

**Important:** Since these classes are now in `app.botdrop` (not relative to the app namespace `com.termux`), use fully qualified names: `app.botdrop.BotDropLauncherActivity` instead of `.app.botdrop.BotDropLauncherActivity`.

**Step 2: Commit**

```bash
git add -A && git commit -m "refactor: update AndroidManifest component paths to app.botdrop"
```

---

### Task 5: Update applicationId and build config

Change the application identifier from `com.termux` to `app.botdrop`.

**Files:**
- Modify: `app/build.gradle`

**Step 1: Add applicationId to defaultConfig**

In `app/build.gradle`, inside `defaultConfig {}`, add:
```groovy
applicationId "app.botdrop"
```

Keep `namespace "com.termux"` unchanged (this is for R class generation — changing it would break all resource references in Termux core).

**Step 2: Update TERMUX_PACKAGE_NAME manifest placeholder**

In `app/build.gradle`, update the manifest placeholder:
```groovy
TERMUX_PACKAGE_NAME: "app.botdrop"
```

**Note:** This changes the permission name to `app.botdrop.permission.RUN_COMMAND` and provider authorities to `app.botdrop`. This is intentional — we're creating a new app identity.

**Step 3: Update sharedUserId in AndroidManifest.xml**

The manifest has `android:sharedUserId="${TERMUX_PACKAGE_NAME}"`. This will now resolve to `app.botdrop`. Verify this is correct — the app will be a separate Linux user from any existing Termux installation.

**Step 4: Update APK naming references**

In `app/build.gradle`, check the APK output naming. It already uses `botdrop-app_` prefix — verify no `owlia` references remain.

Also check for the `owlia-packages` GitHub URL reference (~line 182-183). Update to `botdrop-packages` if the repo has been renamed, otherwise add a TODO comment.

**Step 5: Commit**

```bash
git add -A && git commit -m "refactor: change applicationId to app.botdrop"
```

---

### Task 6: Update resource files and remaining owlia references

Clean up any remaining owlia references in resources, layouts, strings.

**Files:**
- Modify: `app/src/main/res/layout/fragment_botdrop_agent_select.xml` (OwliaBot references — these stay as "OwliaBot" since it's a product name)
- Modify: `termux-shared/src/main/res/values/strings.xml` (verify app name entities)
- Check: All layout XML files for any remaining owlia references

**Step 1: Search all resource files**

```bash
grep -rn -i "owlia" app/src/main/res/ termux-shared/src/main/res/
```

**Step 2: Fix any references found**

- "OwliaBot" as a product/agent name should STAY as "OwliaBot" (it's the name of the agent, not the app)
- Any "Owlia" that refers to the app should become "BotDrop"
- `owlia.bot` URL reference stays (it's the agent's website)

**Step 3: Verify strings.xml entities**

In `termux-shared/src/main/res/values/strings.xml`, confirm:
- `TERMUX_APP_NAME` entity = "BotDrop"
- All sub-app names = "BotDrop:API", "BotDrop:Boot", etc.

**Step 4: Commit**

```bash
git add -A && git commit -m "refactor: clean up remaining Owlia references in resources"
```

---

### Task 7: Update CI/CD and workflow files

**Files:**
- Modify: `.github/workflows/build-apk.yml`

**Step 1: Update GitHub workflow**

- Line ~38: Echo message referencing owlia-packages → botdrop-packages
- Line ~40: Download URL `owlia-packages` → `botdrop-packages` (or add TODO if repo not yet renamed)
- Line ~76: APK basename prefix — verify already uses `botdrop-app_`

**Step 2: Commit**

```bash
git add -A && git commit -m "refactor: update CI workflow references from owlia to botdrop"
```

---

### Task 8: Build verification

**Step 1: Clean build the project**

```bash
cd /Users/zhixian/Codes/owlia-android/.worktrees/opensource-release
./gradlew clean assembleDebug 2>&1 | tail -50
```

Expected: BUILD SUCCESSFUL

**Step 2: If build fails, fix compilation errors**

Common issues:
- Missing imports (old package path referenced somewhere)
- Unresolved class names
- Manifest merge conflicts

Search for remaining issues:
```bash
grep -rn "com.termux.app.owlia" --include="*.java" --include="*.xml" --include="*.gradle" .
```

**Step 3: Commit any fixes**

```bash
git add -A && git commit -m "fix: resolve build issues after rename"
```

---

## Phase 2: UI Optimization

### Task 9: Update color scheme

Define the BotDrop dark theme color palette.

**Files:**
- Modify: `app/src/main/res/values/colors.xml`
- Modify: `app/src/main/res/values/themes.xml`
- Modify: `app/src/main/res/values-night/themes.xml`
- Modify: `app/src/main/res/values/styles.xml`

**Step 1: Update colors.xml**

Add BotDrop brand colors:
```xml
<color name="botdrop_background">#1A1A1A</color>
<color name="botdrop_surface">#2A2A2A</color>
<color name="botdrop_on_background">#F5F0E6</color>
<color name="botdrop_secondary_text">#888888</color>
<color name="botdrop_accent">#E8A853</color>
<color name="botdrop_accent_dark">#C08A3A</color>
```

Keep existing status colors (`status_connected`, `status_disconnected`).

**Step 2: Update themes.xml**

Create/modify BotDrop theme to use dark colors:
- `colorPrimary` → `#1A1A1A`
- `colorPrimaryDark` → `#111111`
- `colorAccent` → `#E8A853`
- `android:windowBackground` → `@color/botdrop_background`
- `android:textColor` → `@color/botdrop_on_background`
- `android:statusBarColor` → `#111111`
- `android:navigationBarColor` → `#111111`

Apply to both `themes.xml` and `values-night/themes.xml`. Since we're forcing dark theme only, both should have the same dark values.

**Step 3: Update styles.xml**

Update button styles, dialog styles to use gold accent.

**Step 4: Commit**

```bash
git add -A && git commit -m "feat: apply BotDrop dark theme with gold accent colors"
```

---

### Task 10: Replace launcher icon

Generate and install new adaptive launcher icon from app-logo.png.

**Files:**
- Replace: All `app/src/main/res/mipmap-*/ic_launcher.png`
- Replace: All `app/src/main/res/mipmap-*/ic_launcher_round.png`
- Replace: All `app/src/main/res/drawable-*/ic_foreground.png`
- Modify: `app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml`
- Modify: `app/src/main/res/mipmap-anydpi-v26/ic_launcher_round.xml`

**Step 1: Generate density-specific icons from app-logo.png (728x728)**

Use `sips` (macOS) to resize for each density:
- mdpi: 48x48
- hdpi: 72x72
- xhdpi: 96x96
- xxhdpi: 144x144
- xxxhdpi: 192x192

For foreground (adaptive icon), sizes are larger (108dp base):
- mdpi: 108x108
- hdpi: 162x162
- xhdpi: 216x216
- xxhdpi: 324x324
- xxxhdpi: 432x432

**Step 2: Copy resized icons to mipmap directories**

Replace existing `ic_launcher.png` and `ic_launcher_round.png` in each density bucket.

**Step 3: Copy resized foreground to drawable directories**

Replace existing `ic_foreground.png` in each `drawable-*dpi` directory.

**Step 4: Update adaptive icon XML**

Verify `mipmap-anydpi-v26/ic_launcher.xml` has:
```xml
<adaptive-icon>
    <background android:drawable="@color/botdrop_background"/>
    <foreground android:drawable="@drawable/ic_foreground"/>
    <monochrome android:drawable="@drawable/ic_foreground"/>
</adaptive-icon>
```

Use `@color/botdrop_background` (#1A1A1A) as adaptive icon background.

**Step 5: Update banner.png**

Replace `app/src/main/res/drawable/banner.png` (320x180) — create a simple banner with BotDrop branding (dark background + logo). Or remove TV banner if not needed.

**Step 6: Commit**

```bash
git add -A && git commit -m "feat: replace launcher icon with BotDrop logo"
```

---

### Task 11: Replace in-app branding (💧 → logo)

Replace water droplet emojis with the actual BotDrop logo throughout the UI.

**Files:**
- Create: `app/src/main/res/drawable/botdrop_logo.png` (from app-logo.png, sized appropriately)
- Modify: `app/src/main/res/layout/activity_botdrop_launcher.xml` — replace 💧 emoji TextViews with ImageViews
- Modify: `app/src/main/res/layout/activity_botdrop_dashboard.xml` — replace 💧 in header

**Step 1: Create in-app logo drawable**

Resize `app-logo.png` to a reasonable in-app size and place as `drawable/botdrop_logo.png`. A single high-res version (256x256 or so) in `drawable-xxhdpi` works, or place in `drawable` for simplicity.

**Step 2: Update launcher activity layout**

In `activity_botdrop_launcher.xml`:
- Find the 💧 emoji TextView (56sp) in the welcome screen
- Replace with an `ImageView` using `@drawable/botdrop_logo`, width/height ~56dp
- Find the 💧 emoji TextView (48sp) in the loading phase
- Replace with an `ImageView` using `@drawable/botdrop_logo`, width/height ~48dp

**Step 3: Update dashboard activity layout**

In `activity_botdrop_dashboard.xml`:
- Find "💧 BotDrop" header
- Replace with a horizontal LinearLayout containing an ImageView (24dp logo) + TextView ("BotDrop")

**Step 4: Commit**

```bash
git add -A && git commit -m "feat: replace water droplet emoji with BotDrop logo in UI"
```

---

### Task 12: Add agent icons to selection page

Replace emoji icons in agent selection with actual logos.

**Files:**
- Create: `app/src/main/res/drawable/agent_openclaw.png` (from agent-openclaw.png)
- Create: `app/src/main/res/drawable/agent_owliabot.png` (from agent-owliabot.png)
- Modify: `app/src/main/res/layout/fragment_botdrop_agent_select.xml`

**Step 1: Copy agent icons to drawable**

Copy from `/Users/zhixian/Desktop/botdrop-assets/`:
- `agent-openclaw.png` → `app/src/main/res/drawable/agent_openclaw.png`
- `agent-owliabot.png` → `app/src/main/res/drawable/agent_owliabot.png`

**Step 2: Update agent selection layout**

In `fragment_botdrop_agent_select.xml`:
- Replace 🦞 emoji TextView with `ImageView` using `@drawable/agent_openclaw` (64dp × 64dp)
- Replace 🦉 emoji TextView with `ImageView` using `@drawable/agent_owliabot` (64dp × 64dp)

**Step 3: Commit**

```bash
git add -A && git commit -m "feat: add agent logos to selection page"
```

---

### Task 13: Apply consistent button and card styles

Style buttons, cards, and inputs to match botdrop.app aesthetic.

**Files:**
- Modify: All `activity_botdrop_*.xml` and `fragment_botdrop_*.xml` layout files
- Possibly create: `app/src/main/res/drawable/botdrop_button_bg.xml` (rounded gold button shape)
- Possibly create: `app/src/main/res/drawable/botdrop_card_bg.xml` (rounded dark card shape)

**Step 1: Create button drawable**

Create `drawable/botdrop_button_bg.xml`:
```xml
<shape xmlns:android="http://schemas.android.com/apk/res/android"
    android:shape="rectangle">
    <solid android:color="@color/botdrop_accent"/>
    <corners android:radius="8dp"/>
</shape>
```

Create `drawable/botdrop_button_outline_bg.xml` for secondary buttons:
```xml
<shape xmlns:android="http://schemas.android.com/apk/res/android"
    android:shape="rectangle">
    <stroke android:width="2dp" android:color="@color/botdrop_accent"/>
    <corners android:radius="8dp"/>
    <solid android:color="@android:color/transparent"/>
</shape>
```

**Step 2: Create card drawable**

Create `drawable/botdrop_card_bg.xml`:
```xml
<shape xmlns:android="http://schemas.android.com/apk/res/android"
    android:shape="rectangle">
    <solid android:color="@color/botdrop_surface"/>
    <corners android:radius="12dp"/>
</shape>
```

**Step 3: Apply to all BotDrop layouts**

Go through each layout file and:
- Set root backgrounds to `@color/botdrop_background`
- Set card backgrounds to `@drawable/botdrop_card_bg`
- Set primary buttons to `@drawable/botdrop_button_bg` with dark text
- Set secondary/outline buttons to `@drawable/botdrop_button_outline_bg` with gold text
- Set text colors: primary `@color/botdrop_on_background`, secondary `@color/botdrop_secondary_text`
- Set input field backgrounds to `@color/botdrop_surface` with gold accent underline

**Step 4: Commit**

```bash
git add -A && git commit -m "feat: apply consistent BotDrop button and card styling across all layouts"
```

---

## Phase 3: Open-Source Readiness

### Task 14: Write unit tests for BotDropConfig

**Files:**
- Create: `app/src/test/java/app/botdrop/BotDropConfigTest.java`

**Step 1: Create test directory**

```bash
mkdir -p app/src/test/java/app/botdrop
```

**Step 2: Write failing tests**

```java
package app.botdrop;

import org.junit.Test;
import org.junit.Before;
import org.junit.Rule;
import org.junit.rules.TemporaryFolder;
import static org.junit.Assert.*;

import java.io.File;
import java.io.FileWriter;

public class BotDropConfigTest {

    @Rule
    public TemporaryFolder tempFolder = new TemporaryFolder();

    private File configDir;

    @Before
    public void setUp() throws Exception {
        configDir = tempFolder.newFolder("botdrop");
    }

    @Test
    public void readConfig_validJson_returnsCorrectValues() throws Exception {
        // Write a valid config file
        File configFile = new File(configDir, "config.json");
        FileWriter writer = new FileWriter(configFile);
        writer.write("{\"provider\":\"anthropic\",\"apiKey\":\"sk-test-123\"}");
        writer.close();

        // Test reading - adapt to actual BotDropConfig API
        // BotDropConfig config = BotDropConfig.readFrom(configFile);
        // assertEquals("anthropic", config.getProvider());
    }

    @Test
    public void readConfig_missingFile_returnsNull() {
        File configFile = new File(configDir, "nonexistent.json");
        // BotDropConfig config = BotDropConfig.readFrom(configFile);
        // assertNull(config);
    }

    @Test
    public void readConfig_malformedJson_returnsNull() throws Exception {
        File configFile = new File(configDir, "config.json");
        FileWriter writer = new FileWriter(configFile);
        writer.write("{invalid json}");
        writer.close();

        // BotDropConfig config = BotDropConfig.readFrom(configFile);
        // assertNull(config);
    }
}
```

**Note:** The exact test implementation depends on the actual BotDropConfig API. Read `BotDropConfig.java` and adapt tests to test the actual public methods. The tests above are templates — the implementor MUST read the actual class and write tests that match its API.

**Step 3: Run tests to verify they compile and behave correctly**

```bash
./gradlew :app:testDebugUnitTest --tests "app.botdrop.BotDropConfigTest" 2>&1 | tail -20
```

**Step 4: Commit**

```bash
git add -A && git commit -m "test: add unit tests for BotDropConfig"
```

---

### Task 15: Write unit tests for ChannelSetupHelper

**Files:**
- Create: `app/src/test/java/app/botdrop/ChannelSetupHelperTest.java`

**Step 1: Write tests**

Test the setup code decoding logic:
- Valid BOTDROP- prefixed code → correctly decoded
- Invalid prefix → rejected
- Malformed payload → error handling
- Empty/null input → handled gracefully

**Note:** Read `ChannelSetupHelper.java` first to understand the exact decoding logic and write tests that match.

**Step 2: Run tests**

```bash
./gradlew :app:testDebugUnitTest --tests "app.botdrop.ChannelSetupHelperTest" 2>&1 | tail -20
```

**Step 3: Commit**

```bash
git add -A && git commit -m "test: add unit tests for ChannelSetupHelper"
```

---

### Task 16: Write unit tests for BotDropService command construction

**Files:**
- Create: `app/src/test/java/app/botdrop/BotDropServiceTest.java`

**Step 1: Write tests**

Test command string construction and environment variable setup. Since BotDropService is an Android Service, focus on testing the static/pure methods:
- Command string building (e.g., `buildGatewayCommand()`)
- Environment variable map construction
- `isGatewayRunning()` logic (if testable without Android context)

If most methods require Android context, consider extracting testable logic into a helper class, or use Robolectric if already in dependencies. Otherwise, keep tests minimal to what's unit-testable.

**Step 2: Run tests**

```bash
./gradlew :app:testDebugUnitTest --tests "app.botdrop.BotDropServiceTest" 2>&1 | tail -20
```

**Step 3: Commit**

```bash
git add -A && git commit -m "test: add unit tests for BotDropService command construction"
```

---

### Task 17: Code and docs cleanup

**Files:**
- Delete: `docs/plans/` (internal planning documents)
- Delete: `docs/completed/` (internal completion records)
- Delete: `docs/CODE_REVIEW.md` (internal review)
- Keep: `docs/design.md` (useful architecture reference — but review for sensitive content)

**Step 1: Remove internal development docs**

```bash
rm -rf docs/plans/ docs/completed/ docs/CODE_REVIEW.md
```

**Step 2: Audit for hardcoded secrets**

```bash
grep -rn "sk-" --include="*.java" --include="*.xml" --include="*.gradle" .
grep -rn "token" --include="*.java" --include="*.properties" .
grep -rn "password" --include="*.java" --include="*.properties" --include="*.gradle" .
```

The debug keystore password in `app/build.gradle` (`xrj45yWGLbsO7W0v`) is fine to keep — it's a test key.

Remove any real API keys, tokens, or secrets found.

**Step 3: Review git history for sensitive data**

```bash
git log --all --oneline | head -20
```

If history contains commits with secrets, consider:
- Starting fresh with a squashed initial commit, OR
- Using `git filter-branch` / `BFG` to clean history

**Step 4: Clean up /art directory**

The `/art/` directory contains old Termux branding SVGs. Either update or remove.

**Step 5: Commit**

```bash
git add -A && git commit -m "chore: remove internal docs and clean up for open-source release"
```

---

### Task 18: Add LICENSE file

**Files:**
- Create: `LICENSE` (root)

**Step 1: Add GPLv3 license**

Write the full GPLv3 license text to `LICENSE` file. Use the standard FSF text.

**Step 2: Commit**

```bash
git add LICENSE && git commit -m "chore: add GPLv3 license"
```

---

### Task 19: Write README.md

**Files:**
- Create: `README.md` (root, replace any existing)

**Step 1: Write README in English**

Structure:
```markdown
# BotDrop

Run AI agents on your Android phone with zero CLI knowledge.

BotDrop wraps [OpenClaw](https://openclaw.ai) in a guided mobile UI —
install, configure, and manage your AI agent through 4 simple steps.

## Features
- Guided 4-step setup (Auth → Agent → Install → Channel)
- Multi-provider support (Anthropic, OpenAI, Google, OpenRouter, etc.)
- Telegram & Discord bot integration
- Background gateway with auto-restart
- No terminal required

## Screenshots
[TODO: Add screenshots]

## Installation

### Pre-built APK
Download from [Releases](../../releases).

### Build from Source
1. Clone: `git clone https://github.com/<user>/botdrop.git`
2. Open in Android Studio
3. Build: `./gradlew assembleDebug`

Requires: Android SDK, NDK r29+, JDK 11+

## Architecture
BotDrop is built on the [Termux](https://github.com/termux/termux-app) terminal emulator,
providing a Linux environment for running Node.js-based AI agents.

See [docs/design.md](docs/design.md) for detailed architecture.

## Contributing
See [CONTRIBUTING.md](CONTRIBUTING.md).

## License
GPLv3 — see [LICENSE](LICENSE).

## Credits
- Built on [Termux](https://github.com/termux/termux-app) (GPLv3)
- AI agent framework: [OpenClaw](https://openclaw.ai)
```

**Step 2: Commit**

```bash
git add README.md && git commit -m "docs: add README for open-source release"
```

---

### Task 20: Add CONTRIBUTING.md and issue templates

**Files:**
- Create: `CONTRIBUTING.md`
- Create: `.github/ISSUE_TEMPLATE/bug_report.md`
- Create: `.github/ISSUE_TEMPLATE/feature_request.md`

**Step 1: Write CONTRIBUTING.md**

Brief contribution guide:
- How to set up the development environment
- Code style (Java, follow existing conventions)
- How to submit PRs
- Issue reporting guidelines

**Step 2: Create issue templates**

Bug report template:
- Device, Android version
- Steps to reproduce
- Expected vs actual behavior
- Logs

Feature request template:
- Problem description
- Proposed solution

**Step 3: Commit**

```bash
git add -A && git commit -m "docs: add CONTRIBUTING.md and issue templates"
```

---

## Final Verification

After all tasks complete:

1. **Clean build:** `./gradlew clean assembleDebug`
2. **Run tests:** `./gradlew :app:testDebugUnitTest`
3. **Search for remnants:** `grep -rni "owlia" --include="*.java" --include="*.xml" --include="*.gradle" . | grep -v "OwliaBot" | grep -v "owlia.bot"`
4. **Review git log:** Verify commit history is clean
