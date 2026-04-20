# QuranReciter — Build Plan

## What's Done

- React Native 0.85.0 bare workflow project initialized
- `whisper.rn` integrated for on-device Whisper inference (Arabic STT)
- `@fugood/react-native-audio-pcm-stream` for mic capture
- `react-native-fs` for model file management
- **ModelManager** — downloads/caches Whisper `.bin` models from HuggingFace to device storage
- **WhisperService** — loads a Whisper context, runs real-time transcription with word timestamps, Arabic language preset
- **AudioRecorder** — wraps AudioPcmStreamAdapter for raw PCM access
- **useWhisper hook** — React state management for the full model download → record → transcribe flow (auto-loads default `base-ar-quran` model on mount)
- Default model: fine-tuned `base-ar-quran` from `payrawsa/whisper-base-ar-quran-ggml` — auto-downloaded on first launch
- Android `RECORD_AUDIO` permission + iOS `NSMicrophoneUsageDescription` configured

---

## What's Left to Build

### Phase 1: Quran Text Database

**Goal:** Load the full Quran text on-device so we can match transcription against it.

**Data source:** Use the standard Uthmani text with tashkeel (diacritics). A good source is the `quran-json` dataset or the Tanzil.net XML/text files. We need a JSON or SQLite database with this schema:

```
{
  surah: number,        // 1-114
  ayah: number,         // ayah number within surah
  text: string,         // full ayah text with tashkeel (e.g. "بِسْمِ ٱللَّهِ ٱلرَّحْمَـٰنِ ٱلرَّحِيمِ")
  words: [              // pre-split words array
    {
      index: number,    // word position in ayah (0-based)
      text: string,     // word with tashkeel
      textClean: string // word without tashkeel (for matching against Whisper output)
    }
  ]
}
```

**Key files to create:**
- `src/data/quran.json` — full Quran text, pre-processed with word-level splits
- `src/services/QuranDatabase.ts` — loads the JSON, provides lookup methods:
  - `getAyah(surah, ayah)` → returns ayah object
  - `getSurah(surah)` → returns all ayahs in a surah
  - `getAllWords()` → flat array of all words for search indexing
  - `getWordAt(surah, ayah, wordIndex)` → single word

**Important:** Whisper outputs Arabic text **without tashkeel** (no harakat). The Quran text has full tashkeel. So every match/comparison must strip tashkeel first. Create a utility:

```typescript
// src/utils/arabic.ts
function stripTashkeel(text: string): string
  // Remove Unicode range \u0610-\u061A, \u064B-\u065F, \u0670 (fathatan, kasratan, dammatan, fatha, kasra, damma, sukun, shadda, etc.)

function normalizeArabic(text: string): string
  // Strip tashkeel + normalize alef variants (أ إ آ → ا) + normalize taa marbuta/haa, etc.
```

---

### Phase 2: Position Detection (Find Where User Is Reciting)

**Goal:** When the user starts reciting, identify exactly which surah/ayah/word they're at.

**Algorithm:**

1. Accumulate the first 5–10 seconds of Whisper output (roughly 5–15 words)
2. Normalize the transcript (strip tashkeel, normalize letters)
3. Search against a **pre-built n-gram index** of the entire Quran

**N-gram index:** Pre-compute sliding windows of 3–5 consecutive words across the entire Quran. Store as a map:

```typescript
// src/services/QuranSearch.ts

// Build at app startup (or pre-compute in the JSON)
type WordPosition = { surah: number; ayah: number; wordIndex: number }

// Map of "word1 word2 word3" → position of first word
ngramIndex: Map<string, WordPosition>
```

**Search method:**
1. Take the normalized transcript words
2. Extract 3-word sliding windows from the transcript
3. Look up each window in the n-gram index
4. Use voting — the position with the most window matches wins
5. Return the best match position `{ surah, ayah, wordIndex }`

**Edge cases:**
- User starts mid-ayah → the n-gram index handles this since it's word-level, not ayah-level
- Whisper misrecognizes a word → voting across multiple windows makes this robust
- Ambiguous matches (same phrase appears multiple times in Quran) → use longer windows (5-grams) to disambiguate, or present top candidates to user

**Key file:** `src/services/QuranSearch.ts`
- `buildIndex(quranData)` — builds the n-gram map (run once on load)
- `findPosition(transcriptWords: string[])` → `{ surah, ayah, wordIndex, confidence }`

---

### Phase 3: Word Highlighting (Real-Time Tracking)

**Goal:** As the user recites, highlight the current word in the Quran display.

**How it works:**

1. After position detection locks onto a starting point, we know which word is next
2. Whisper's transcription comes in with **word-level timestamps** (t0, t1 per segment)
3. For each new Whisper segment:
   - Normalize the recognized word
   - Compare against the **expected next word** in the Quran (also normalized)
   - If it matches → advance the highlight cursor to the next word
   - If it doesn't match → check if it matches word+1, word+2 (user may have skipped), or word-1 (user repeated)

**Tracking state:**

```typescript
// src/services/RecitationTracker.ts

type TrackingState = {
  surah: number
  ayah: number
  wordIndex: number         // current word position
  status: 'seeking' | 'tracking' | 'lost'
  errors: RecitationError[]
}

type RecitationError = {
  surah: number
  ayah: number
  wordIndex: number
  expected: string
  got: string
  type: 'substitution' | 'omission' | 'insertion' | 'repetition'
}
```

**Key file:** `src/services/RecitationTracker.ts`
- `startTracking(surah, ayah, wordIndex)` — initialize from position detection result
- `processTranscription(segments)` — called each time Whisper emits new segments
- `getCurrentPosition()` → current `{ surah, ayah, wordIndex }`
- `getErrors()` → list of errors found so far
- Emits events: `onPositionChange`, `onError`, `onAyahComplete`

**UI updates:**

```typescript
// src/screens/RecitationScreen.tsx (new main screen)

// Display Quran text with per-word highlighting:
// - Gray: upcoming words
// - Green/highlighted: current word being spoken
// - Green checkmark: correctly recited words
// - Red: words with errors
// - Scroll automatically to keep current word in view
```

**Word matching logic (in RecitationTracker):**

```
For each new transcribed word:
  1. normalize(transcribedWord)
  2. normalize(expectedWord at current position)
  3. If exact match → CORRECT, advance cursor
  4. If no match → check next 2 words ahead (maybe user skipped)
     - If match at +1 → flag omission error on skipped word, advance to +1
     - If match at +2 → flag omission errors, advance to +2
  5. If still no match → check if Levenshtein distance < threshold
     - If close enough → likely pronunciation variant, accept with warning
     - If too far → flag substitution error, advance cursor anyway
  6. If same word appears twice → flag repetition, don't advance
```

---

### Phase 4: Error Detection & Flagging

**Goal:** Catch recitation mistakes and show them to the user.

**Error types (v1 — text-level only):**

| Error Type | Detection Method |
|---|---|
| **Wrong word** (substitution) | Transcribed word ≠ expected word, Levenshtein distance > threshold |
| **Skipped word** (omission) | Transcript jumps ahead — expected word never appeared |
| **Extra word** (insertion) | Transcribed word doesn't match expected or any nearby word |
| **Repeated word** (repetition) | Same word transcribed twice consecutively when only expected once |
| **Skipped ayah** | Word position jumps to a different ayah unexpectedly |

**This is implemented inside RecitationTracker.processTranscription() from Phase 3.**

**Key file additions:**
- `src/services/RecitationTracker.ts` — error detection logic (same file as Phase 3)
- `src/components/ErrorOverlay.tsx` — shows error summary after a session
- `src/components/AyahDisplay.tsx` — renders a single ayah with word-level color coding

**Post-session summary screen:**
- Total ayahs recited
- Number of errors by type
- List of specific errors with expected vs. got
- Option to re-recite problematic ayahs

---

### Phase 5: Full Recitation UI

**Goal:** Final polished screen for actual Quran recitation practice.

**Screen: `src/screens/RecitationScreen.tsx`**

Layout:
```
┌─────────────────────────────┐
│  Surah Name / Ayah Range    │  ← header with surah selector
├─────────────────────────────┤
│                             │
│  بِسْمِ ٱللَّهِ ٱلرَّحْمَـٰنِ ٱلرَّحِيمِ  │  ← current ayah, word-highlighted
│                             │
│  ٱلْحَمْدُ لِلَّهِ رَبِّ ٱلْعَـٰلَمِينَ   │  ← next ayah (dimmed)
│                             │
├─────────────────────────────┤
│     [ ● Record / ■ Stop ]   │  ← record button
├─────────────────────────────┤
│  Status: Tracking word 3/7  │  ← progress info
│  Errors: 0                  │
└─────────────────────────────┘
```

**Components to build:**
- `src/components/QuranWordView.tsx` — renders a single Arabic word with highlight state (normal, active, correct, error)
- `src/components/AyahDisplay.tsx` — renders an ayah as a row of QuranWordView components
- `src/components/SurahSelector.tsx` — picker to choose starting surah/ayah
- `src/components/SessionSummary.tsx` — end-of-session error report

---

## Build Order Summary

| Phase | What | Depends On |
|---|---|---|
| 1 | Quran text database + arabic utils | Nothing |
| 2 | Position detection (n-gram search) | Phase 1 |
| 3 | Word highlighting + recitation tracking | Phase 1, 2 |
| 4 | Error detection + flagging | Phase 3 |
| 5 | Full recitation UI | Phase 1–4 |

Phases 1 and 2 can be built and tested independently of the Whisper recording (use hardcoded test strings). Phases 3–5 require a working Whisper setup on a real device.
