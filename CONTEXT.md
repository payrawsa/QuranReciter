# QuranReciter — Agent Context

> **Purpose of this file:** Give a Claude agent (or any LLM coding agent) fast, complete context about this project so it can make informed edits without re-exploring the codebase. This is NOT user documentation.

---

## Project Summary

**QuranReciter** is a React Native bare-workflow mobile app (iOS + Android) that uses on-device Whisper speech-to-text to help users practice Quran recitation. The user recites into the microphone; the app identifies their position in the Quran, tracks word-by-word progress in real time, and flags errors (skipped words, skipped ayahs).

All inference is local — no network calls for speech recognition. The Whisper model is downloaded once from HuggingFace and cached on-device.

---

## Tech Stack

| Layer | Technology | Version |
|---|---|---|
| Framework | React Native (bare workflow, no Expo) | 0.85.0 |
| Language | TypeScript | 5.8.3 |
| JS Engine | Hermes (enabled in gradle.properties) | — |
| React | React | 19.2.3 |
| Speech-to-text | whisper.rn | ^0.5.5 |
| Audio capture | @fugood/react-native-audio-pcm-stream | ^1.1.4 |
| File system | react-native-fs | ^2.20.0 |
| Safe area | react-native-safe-area-context | ^5.5.2 |
| Testing | Jest + @react-native/jest-preset | 29.x |
| Node | >= 22.11.0 required | — |

---

## Architecture Overview

```
App.tsx                          ← Root: switches between RecorderScreen and RecitationScreen
├── screens/
│   ├── RecorderScreen.tsx       ← Model management UI (download/load Whisper model, test mic)
│   └── RecitationScreen.tsx     ← Main recitation practice UI (Phase 5)
├── components/
│   ├── QuranWordView.tsx        ← Single Arabic word with animated highlight states
│   ├── AyahDisplay.tsx          ← Renders one ayah as a row of QuranWordView components
│   ├── SurahSelector.tsx        ← Modal: pick surah → pick ayah number
│   ├── SessionSummary.tsx       ← Modal: post-session error report
│   └── ErrorOverlay.tsx         ← Legacy overlay (pre-Phase 5, still exported)
├── hooks/
│   └── useWhisper.ts            ← React hook: model download → load → record → transcribe
├── services/
│   ├── ModelManager.ts          ← Downloads/caches Whisper .bin models from HuggingFace
│   ├── WhisperService.ts        ← Wraps whisper.rn context: init, realtime transcription (Arabic, VAD, word timestamps)
│   ├── AudioRecorder.ts         ← Wraps AudioPcmStreamAdapter for raw 16-bit PCM at 16kHz mono
│   ├── QuranDatabase.ts         ← Loads quran.json, provides lookup by surah/ayah/word
│   ├── QuranSearch.ts           ← N-gram index (trigrams + pentagrams) for position detection
│   ├── RecitationTracker.ts     ← Word-by-word tracking with error detection
│   └── index.ts                 ← Re-exports all services and types
├── utils/
│   ├── arabic.ts                ← stripTashkeel(), normalizeArabic(), splitArabicWords()
│   └── permissions.ts           ← requestMicrophonePermission() (Android runtime, iOS auto)
├── data/
│   └── quran.json               ← Full Quran text (6236 ayahs, pre-split words with tashkeel + clean variants)
└── scripts/
    └── generate-quran-data.js   ← Fetches from alquran.cloud API → generates src/data/quran.json
```

---

## Data Model

### quran.json schema (each element)
```typescript
{
  surah: number;        // 1–114
  surahName: string;    // Arabic surah name
  ayah: number;         // Ayah number within surah
  text: string;         // Full ayah text with tashkeel
  words: [
    {
      index: number;    // 0-based word position in ayah
      text: string;     // Word with tashkeel (display)
      textClean: string // Word without tashkeel (matching)
    }
  ]
}
```

### Key types (from services/)
```typescript
// QuranDatabase
AyahData, QuranWord, FlatWord

// QuranSearch
WordPosition { surah, ayah, wordIndex }
SearchResult { position, confidence, matchCount, totalWindows }

// RecitationTracker
TrackingStatus = 'idle' | 'tracking' | 'completed'
WordStatus = 'upcoming' | 'active' | 'correct' | 'skipped'
RecitationError { type: 'omission' | 'ayah_skip', surah, ayah, wordIndex, expectedWord }
PositionChangeEvent, AyahCompleteEvent, TrackerCallbacks

// WhisperService
TranscriptionUpdate, TranscriptionSegment, WhisperServiceCallbacks

// ModelManager
ModelSize, ModelInfo, DownloadProgress, DownloadCallbacks
```

### Service instantiation patterns

| Module | Pattern | Usage |
|---|---|---|
| `QuranDatabase` | Exported **object** (singleton) | `QuranDatabase.getAyah(1, 1)` — no `new` |
| `QuranSearch` | Exported **object** (singleton) | `QuranSearch.buildIndex()` — no `new` |
| `RecitationTracker` | Exported **class** | `new RecitationTracker()` |
| `WhisperService` | Exported **class** | `new WhisperService()` |
| `ModelManager` | Exported **class** | `new ModelManager()` |
| `AudioRecorder` | Exported **class** | `new AudioRecorder()` |

Components have **no barrel export file** — import directly: `import { AyahDisplay } from '../components/AyahDisplay'`.

---

## App Flow

1. **RecorderScreen**: User downloads a Whisper model (tiny/base/small/medium), model is cached in app's document directory. Once loaded, user can test raw transcription.
2. **RecitationScreen** (navigated via "Start Recitation ›" button when model is ready):
   - User selects surah/ayah via `SurahSelector`
   - Taps record → enters **seeking** phase (accumulates transcript words, runs `QuranSearch.findPosition()`)
   - When position found with confidence ≥ 0.3 → enters **tracking** phase
   - `RecitationTracker` matches each 3-word window against current+next ayah scope
   - UI shows previous (dimmed), current (highlighted word-by-word), and next (dimmed) ayahs
   - On stop → shows `SessionSummary` with error report and per-error retry buttons

### RecitationScreen state machine

```
idle ──[record]──► seeking ──[position found]──► tracking ──[stop]──► stopped
  ▲                  │                              │                   │
  └──────────────────┴──────────[stop]──────────────┘                   │
  └─────────────────────────────[dismiss summary]───────────────────────┘
```

- **idle**: Waiting. User picks surah/ayah. Record button available.
- **seeking**: Recording active. Accumulates words, feeds to `QuranSearch.findPosition()`. Minimum 3 words needed.
- **tracking**: Position locked. Each Whisper update → `splitArabicWords()` → `normalizeArabic()` each → `tracker.processWords()`. UI updates via tracker callbacks.
- **stopped**: Recording stopped. `SessionSummary` modal shown with errors and retry buttons.

### Data pipeline (Whisper → Tracker)

```
Whisper onTranscription → transcription.text
  → splitArabicWords(text)        // split by whitespace
  → words.map(normalizeArabic)    // strip tashkeel + normalize
  → [seeking]  QuranSearch.findPosition(words)
  → [tracking] tracker.processWords(words)
```

`QuranSearch.buildIndex()` is called in a `useEffect` on RecitationScreen mount (runs once, cached in memory).

---

## Arabic Text Matching

Whisper outputs Arabic **without tashkeel**. Quran text has full tashkeel.

`normalizeArabic()` handles:
- Strip tashkeel (harakat: \u0610-\u061A, \u064B-\u065F, \u0670, etc.)
- Normalize alef variants (أ إ آ ٱ → ا)
- Normalize taa marbuta → haa (ة → ه)
- Normalize alef maqsura → yaa (ى → ي)
- Remove tatweel/kashida (ـ)
- Collapse whitespace

All comparison between Whisper output and Quran text **must** go through `normalizeArabic()`.

### WhisperService configuration

These are the key Whisper inference settings in `WhisperService.ts`:
- **Language**: `'ar'` (Arabic)
- **GPU**: enabled (`useGpu: true`, `useFlashAttn: true`)
- **Audio slicing**: `audioSliceSec: 25`, `audioMinSec: 1`
- **Word timestamps**: `tokenTimestamps: true`, `maxLen: 1` (one word per segment)
- **Word confidence threshold**: `wordThold: 0.6`
- **VAD**: `vadPreset: 'default'`, `autoSliceOnSpeechEnd: true`

---

## UI Design System

- **Dark theme** throughout: background `#0d1117`, card surfaces `#141b22`
- **Green accent**: `#5bd882` — correctly recited words, success, primary buttons
- **Red accent**: `#f75555` — errors, recording indicator, skipped words (line-through)
- **White text**: `#FFFFFF` — active/current word (with pulse animation + glow)
- **Muted text**: `#667788` for secondary labels, `#8899AA` for upcoming words (opacity 0.6)
- **Border lines**: `rgba(255,255,255,0.06)` hairline separators
- **RTL layout**: `flexDirection: 'row-reverse'` for Arabic word containers
- **Record button**: Circular, red fill, morphs to rounded square when recording
- **Animation**: `QuranWordView` uses `Animated` pulse for the active word

---

## Build & Run

### Prerequisites
- Node.js >= 22.11.0
- Yarn or npm
- For iOS: macOS, Xcode, CocoaPods (`gem install cocoapods`)
- For Android: Android Studio, Android SDK 36, NDK 27.1.12297006

### Install dependencies
```bash
npm install
# or
yarn install
```

### Generate Quran data (only if quran.json is missing)
```bash
node scripts/generate-quran-data.js
```

### Android
```bash
npx react-native run-android
# or
npm run android
```

### iOS
```bash
cd ios && pod install && cd ..
npx react-native run-ios
# or
npm run ios
```

### Run tests
```bash
npm test
```

### Lint
```bash
npm run lint
```

---

## Platform Configuration

### Android
- **Namespace / App ID**: `com.quranreciter`
- **Min SDK**: 24 (Android 7.0)
- **Target/Compile SDK**: 36
- **NDK**: 27.1.12297006
- **Kotlin**: 2.1.20
- **Gradle**: 9.3.1
- **Hermes**: Enabled
- **New Architecture**: Enabled
- **Permissions**: INTERNET, RECORD_AUDIO
- **RTL**: `android:supportsRtl="true"` in manifest
- **Signing**: Debug keystore only (release signing not configured yet)
- **Supported ABIs**: armeabi-v7a, arm64-v8a, x86, x86_64

### iOS
- **Bundle ID**: Set via Xcode (PRODUCT_BUNDLE_IDENTIFIER)
- **Min iOS version**: Determined by React Native (currently ~15.1+)
- **Required capability**: arm64
- **Orientation**: Portrait (iPhone), all (iPad)
- **Microphone usage**: Described in Info.plist
- **ATS**: Arbitrary loads OFF, local networking ON
- **Mac Catalyst**: Disabled
- **CocoaPods**: Managed via Podfile, auto-linking via `use_native_modules!`

---

## App Store / Google Play Release Checklist

### Both platforms
- [ ] Change `version` in package.json from `0.0.1` to real version
- [ ] Change `displayName` in app.json if needed
- [ ] Create app icon assets (all required sizes for both platforms)
- [ ] Create splash/launch screen design
- [ ] Add privacy policy URL
- [ ] Test on real devices (Whisper needs real microphone, not emulator)
- [ ] Remove `NSLocationWhenInUseUsageDescription` from Info.plist (empty, unused — App Store will reject)
- [ ] Disable cleartext traffic (`usesCleartextTraffic` in manifest — ensure it's false for release)

### Android (Google Play)
- [ ] Create release signing keystore:
  ```bash
  keytool -genkeypair -v -storetype PKCS12 -keystore release.keystore -alias quranreciter -keyalg RSA -keysize 2048 -validity 10000
  ```
- [ ] Configure release signing in `android/app/build.gradle` (currently uses debug keystore for release — **must change**)
- [ ] Set real `versionCode` and `versionName` in `android/app/build.gradle`
- [ ] Consider enabling ProGuard/R8 (`enableProguardInReleaseBuilds = true`) + test to ensure Hermes/JSC compatibility
- [ ] Build release AAB: `cd android && ./gradlew bundleRelease`
- [ ] Set up Google Play Console: create app listing, content rating, data safety form
- [ ] targetSdkVersion must meet Google Play's latest requirement (currently 36 — good)
- [ ] Large app warning: quran.json is bundled (~6.5 MB). Consider if Play Store asset delivery is needed.

### iOS (App Store)
- [ ] Set `PRODUCT_BUNDLE_IDENTIFIER` in Xcode (e.g. `com.yourorg.quranreciter`)
- [ ] Set `MARKETING_VERSION` and `CURRENT_PROJECT_VERSION` in Xcode project
- [ ] Configure Apple Developer Team ID for signing
- [ ] Create App Store Connect app record
- [ ] Archive in Xcode → upload to App Store Connect
- [ ] Fill out App Store metadata: description, keywords, screenshots, categories
- [ ] Privacy nutrition labels: mark microphone usage, on-device speech recognition
- [ ] The `PrivacyInfo.xcprivacy` file exists — ensure required API declarations are complete
- [ ] Test on physical iPhone (Whisper model download + mic recording)

---

## Test Files

```
__tests__/
├── App.test.tsx              ← Basic app render test
├── arabic.test.ts            ← Tests for stripTashkeel, normalizeArabic, splitArabicWords
├── QuranDatabase.test.ts     ← Tests for ayah/surah lookup, word navigation
├── QuranSearch.test.ts       ← Tests for n-gram index building & position detection
└── RecitationTracker.test.ts ← Tests for word tracking, skip detection, error flagging
```

Run with `npm test`. Uses Jest with `@react-native/jest-preset`.

---

## Known Constraints & Gotchas

1. **Whisper requires real device**: Emulators don't have working microphones for real-time audio capture via `AudioPcmStreamAdapter`.
2. **quran.json is large**: ~6.5 MB bundled JSON. Loaded synchronously via `import` at startup. If app launch is slow, consider lazy loading.
3. **N-gram index build time**: `QuranSearch.buildIndex()` is called in `useEffect` on RecitationScreen mount. It processes the entire Quran (~82K words) and is cached in module-level variables. Subsequent calls are effectively free.
4. **No navigation library**: Screen switching is done via state in `App.tsx` (`'recorder' | 'recitation'`). If more screens are added, install `@react-navigation/native`.
5. **useWhisper hook is shared**: Both RecorderScreen and RecitationScreen use `useWhisper()` independently. If both are mounted simultaneously, they'd create separate Whisper contexts. Current architecture avoids this by only rendering one at a time.
6. **Release signing not configured**: Both Android and iOS use debug signing. Must be set up before store submission.
7. **Hermes + New Architecture**: Both are enabled. All native modules must be compatible.
8. **Model sizes**: Whisper models: tiny (~75 MB), base (~142 MB), small (~466 MB, recommended), medium (~1530 MB). No "large" model is offered. User downloads on first use → stored via react-native-fs in the app's document directory.
