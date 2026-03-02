# Crashlytics Integration Plan

## Integration points
- `build.gradle` (root): add Google Services and Firebase Crashlytics Gradle plugin classpaths.
- `app/build.gradle`: apply required plugins (guarded when `google-services.json` is present), add Crashlytics SDK dependency, and enable release mapping upload.
- `app/src/main/java/com/termux/app/TermuxApplication.java`: initialize Firebase safely and set Crashlytics collection policy at startup.
- Settings stack (`termux-shared` preferences + `app` debugging prefs XML/fragment): add a runtime toggle hook to enable/disable Crashlytics collection without shipping analytics.
- `docs/`: add setup/privacy notes for maintainers.

## Implementation steps
1. Add Gradle plugin classpaths for:
   - `com.google.gms:google-services`
   - `com.google.firebase:firebase-crashlytics-gradle`
2. In `app/build.gradle`:
   - Apply `com.google.firebase.crashlytics` and `com.google.gms.google-services` only when `app/google-services.json` exists to keep OSS builds working.
   - Add `firebase-bom` + `firebase-crashlytics` dependency (no analytics dependency).
   - Set build config defaults:
     - `debug`: Crashlytics disabled by default.
     - `release`: Crashlytics enabled by default.
   - Enable mapping uploads for release via `firebaseCrashlytics { mappingFileUploadEnabled true }` when plugin is applied.
3. Add runtime control:
   - Add a new preference key in `TermuxPreferenceConstants.TERMUX_APP`.
   - Add getter/setter in `TermuxAppSharedPreferences`.
   - Add `SwitchPreferenceCompat` in `termux_debugging_preferences.xml` + strings.
   - Wire the key in `DebuggingPreferencesDataStore` and call a shared helper to immediately apply toggle to Crashlytics.
4. In `TermuxApplication.onCreate()`:
   - Try `FirebaseApp.initializeApp(context)` and skip if config missing.
   - Compute effective collection setting from build default + preference override.
   - Apply with `FirebaseCrashlytics.getInstance().setCrashlyticsCollectionEnabled(...)`.
5. Document usage and privacy in `docs/crashlytics.md` and link from `README.md`.
6. Validate with a local Gradle build command.

## Safety defaults
- No PII user identifiers or custom keys added.
- No Firebase Analytics dependency added.
- Debug builds default to no Crashlytics collection.
- OSS contributors can build without `google-services.json`; Crashlytics wiring stays inert.
