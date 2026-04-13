/**
 * RecitationTracker — tracks the user's position during Quran recitation.
 *
 * After QuranSearch locks the starting position, the tracker narrows scope
 * to *current ayah + next ayah* only. It uses character-level fuzzy matching
 * (longest common substring) against the scope text to find the user's
 * position, tolerating Whisper transcription errors like extra/missing
 * letters and word boundary differences.
 *
 * As the user completes an ayah the window shifts forward automatically.
 * Skipped words (and skipped ayahs) are detected and recorded as errors.
 */

import { QuranDatabase, type AyahData, type QuranWord } from './QuranDatabase';
import { normalizeArabic, arabicLettersOnly } from '../utils/arabic';

// ── Public types ──────────────────────────────────────────────────────

export type WordPosition = {
  surah: number;
  ayah: number;
  wordIndex: number;
};

export type TrackingStatus = 'idle' | 'tracking' | 'completed';

export type RecitationErrorType = 'omission' | 'ayah_skip';

export type RecitationError = {
  type: RecitationErrorType;
  surah: number;
  ayah: number;
  wordIndex: number;       // the word that was skipped (-1 for full ayah skip)
  expectedWord: string;    // the Quran word (with tashkeel) that was missed
};

/** Per-word status for UI rendering */
export type WordStatus = 'upcoming' | 'active' | 'correct' | 'skipped';

export type PositionChangeEvent = {
  previous: WordPosition;
  current: WordPosition;
  skippedWords: RecitationError[];  // any words skipped in this jump
};

export type AyahCompleteEvent = {
  surah: number;
  ayah: number;
};

export type TrackerCallbacks = {
  onPositionChange?: (event: PositionChangeEvent) => void;
  onAyahComplete?: (event: AyahCompleteEvent) => void;
  onError?: (error: RecitationError) => void;
};

// ── Constants ─────────────────────────────────────────────────────────

/** Minimum characters from Whisper to attempt matching. */
const MIN_CHARS = 5;

/** Minimum ratio of matched chars to transcript chars to accept a match. */
const MIN_MATCH_RATIO = 0.4;

// ── Internal: flattened word list for the search scope ─────────────

type ScopeWord = {
  text: string; // normalized (clean) text
  surah: number;
  ayah: number;
  wordIndex: number;
  /** Linear offset within the scope (0-based) */
  offset: number;
  /** Character start index in the scope's concatenated char string */
  charStart: number;
  /** Character end index (exclusive) in the scope's concatenated char string */
  charEnd: number;
};

// ── Tracker ───────────────────────────────────────────────────────────

export class RecitationTracker {
  private status: TrackingStatus = 'idle';
  private cursor: WordPosition = { surah: 0, ayah: 0, wordIndex: 0 };
  private callbacks: TrackerCallbacks = {};
  private errors: RecitationError[] = [];

  // The flattened word list covering current + next ayah
  private scope: ScopeWord[] = [];
  // Concatenated normalized characters of all words in scope (no spaces)
  private scopeChars = '';
  // The offset within `scope` that corresponds to the cursor
  private cursorOffset = 0;
  // Character position of cursor in scopeChars
  private cursorCharPos = 0;
  // The ayah numbers currently in scope
  private currentAyah: AyahData | null = null;
  private nextAyah: AyahData | null = null;

  // Track which words have been correctly recited or skipped
  // Key: "surah:ayah:wordIndex"
  private wordStatuses = new Map<string, WordStatus>();

  // ── Lifecycle ─────────────────────────────────────────────────────

  /**
   * Begin tracking from a known position (output of QuranSearch.findPosition).
   */
  startTracking(
    surah: number,
    ayah: number,
    wordIndex: number,
    callbacks?: TrackerCallbacks,
  ): void {
    this.cursor = { surah, ayah, wordIndex };
    this.callbacks = callbacks ?? {};
    this.status = 'tracking';
    this.errors = [];
    this.wordStatuses.clear();
    this.rebuildScope();
  }

  /**
   * Stop tracking and reset state.
   */
  stop(): void {
    this.status = 'idle';
    this.scope = [];
    this.scopeChars = '';
    this.cursorOffset = 0;
    this.cursorCharPos = 0;
    this.currentAyah = null;
    this.nextAyah = null;
  }

  /**
   * Current status of the tracker.
   */
  getStatus(): TrackingStatus {
    return this.status;
  }

  /**
   * Current cursor position in the Quran.
   */
  getCurrentPosition(): WordPosition {
    return { ...this.cursor };
  }

  /**
   * Get all errors accumulated during this session.
   */
  getErrors(): RecitationError[] {
    return [...this.errors];
  }

  /**
   * Get the status of a specific word for UI rendering.
   */
  getWordStatus(surah: number, ayah: number, wordIndex: number): WordStatus {
    return this.wordStatuses.get(`${surah}:${ayah}:${wordIndex}`) ?? 'upcoming';
  }

  /**
   * Get statuses for all words in an ayah (for rendering AyahDisplay).
   */
  getAyahWordStatuses(surah: number, ayah: number): WordStatus[] {
    const ayahData = QuranDatabase.getAyah(surah, ayah);
    if (!ayahData) return [];
    return ayahData.words.map((_, i) => this.getWordStatus(surah, ayah, i));
  }

  // ── Core: process new transcription ────────────────────────────────

  /**
   * Feed new transcript words from Whisper. Converts to characters,
   * finds the best fuzzy match in the scope from cursorCharPos onward,
   * and advances the cursor to the matched word.
   *
   * @param words — array of raw transcript words (will be normalized)
   */
  processWords(words: string[]): void {
    if (this.status !== 'tracking' || words.length === 0) {
      return;
    }

    // Normalize and extract Arabic-only characters from transcript
    const transcriptChars = arabicLettersOnly(
      words.map(w => normalizeArabic(w)).join(''),
    );

    if (transcriptChars.length < MIN_CHARS) {
      return;
    }

    // Find best match position in scope characters from cursor onward
    const searchFrom = this.cursorCharPos;
    const matchResult = this.findBestCharMatch(transcriptChars, searchFrom);

    if (!matchResult) {
      return; // no sufficient match — cursor stays
    }

    // Map the matched character end position back to a word
    const matchedWord = this.charPosToWord(matchResult.endCharPos);
    if (!matchedWord) return;

    const newOffset = matchedWord.offset;
    if (newOffset <= this.cursorOffset) return; // no forward progress

    // ── Detect skipped words between old cursor and the new position ──
    // Find the word at the match start
    const startWord = this.charPosToWord(matchResult.startCharPos);
    const skipUpTo = startWord ? startWord.offset : newOffset;
    const skippedWords = this.detectSkippedWords(this.cursorOffset, skipUpTo);

    // Mark words covered by the match as correct
    const startOffset = startWord ? startWord.offset : newOffset;
    for (let i = startOffset; i <= newOffset; i++) {
      const sw = this.scope[i];
      if (sw) {
        this.wordStatuses.set(
          `${sw.surah}:${sw.ayah}:${sw.wordIndex}`,
          'correct',
        );
      }
    }

    const prevPos = { ...this.cursor };
    this.cursor = {
      surah: matchedWord.surah,
      ayah: matchedWord.ayah,
      wordIndex: matchedWord.wordIndex,
    };
    this.cursorOffset = newOffset;
    this.cursorCharPos = matchedWord.charEnd;

    // Emit position change
    if (
      prevPos.surah !== this.cursor.surah ||
      prevPos.ayah !== this.cursor.ayah ||
      prevPos.wordIndex !== this.cursor.wordIndex
    ) {
      this.callbacks.onPositionChange?.({
        previous: prevPos,
        current: { ...this.cursor },
        skippedWords,
      });
    }

    // Check if the current ayah is completed
    this.checkAyahCompletion();
  }

  // ── Internal helpers ──────────────────────────────────────────────

  /**
   * Detect words that were skipped between the old cursor offset and
   * the start of the matched window. Records them as errors and marks
   * them as 'skipped' in wordStatuses.
   */
  private detectSkippedWords(
    oldOffset: number,
    matchStartOffset: number,
  ): RecitationError[] {
    const skipped: RecitationError[] = [];

    // Words between (oldOffset, matchStartOffset) exclusive were skipped.
    // On the first match the cursor is at word 0 and the match may also
    // start at 0, so there's nothing to skip.
    for (let i = oldOffset + 1; i < matchStartOffset; i++) {
      const sw = this.scope[i];
      // Look up the original word with tashkeel
      const quranWord = QuranDatabase.getWordAt(
        sw.surah,
        sw.ayah,
        sw.wordIndex,
      );

      const error: RecitationError = {
        type: 'omission',
        surah: sw.surah,
        ayah: sw.ayah,
        wordIndex: sw.wordIndex,
        expectedWord: quranWord?.text ?? sw.text,
      };

      skipped.push(error);
      this.errors.push(error);
      this.wordStatuses.set(
        `${sw.surah}:${sw.ayah}:${sw.wordIndex}`,
        'skipped',
      );

      this.callbacks.onError?.(error);
    }

    // Check for ayah-level skip: if skipped words span an entire ayah
    this.detectAyahSkips(skipped);

    return skipped;
  }

  /**
   * Check if any complete ayah(s) were skipped and record ayah_skip errors.
   */
  private detectAyahSkips(skippedWords: RecitationError[]): void {
    if (skippedWords.length === 0) return;

    // Group skipped words by surah:ayah
    const byAyah = new Map<string, RecitationError[]>();
    for (const err of skippedWords) {
      const key = `${err.surah}:${err.ayah}`;
      let arr = byAyah.get(key);
      if (!arr) {
        arr = [];
        byAyah.set(key, arr);
      }
      arr.push(err);
    }

    // If all words in an ayah were skipped, record an ayah_skip
    for (const [key, errs] of byAyah) {
      const [surah, ayah] = key.split(':').map(Number);
      const ayahData = QuranDatabase.getAyah(surah, ayah);
      if (ayahData && errs.length === ayahData.words.length) {
        const ayahSkipError: RecitationError = {
          type: 'ayah_skip',
          surah,
          ayah,
          wordIndex: -1,
          expectedWord: ayahData.text,
        };
        this.errors.push(ayahSkipError);
        this.callbacks.onError?.(ayahSkipError);
      }
    }
  }

  /**
   * Rebuild the flattened scope from the current ayah + next ayah,
   * compute character positions, and set cursorOffset/cursorCharPos.
   */
  private rebuildScope(): void {
    this.scope = [];
    this.scopeChars = '';

    this.currentAyah =
      QuranDatabase.getAyah(this.cursor.surah, this.cursor.ayah) ?? null;
    if (!this.currentAyah) {
      this.status = 'completed';
      return;
    }

    // Determine next ayah (handles surah boundary)
    const nextPos = this.getNextAyahPosition(
      this.cursor.surah,
      this.cursor.ayah,
    );
    this.nextAyah = nextPos
      ? QuranDatabase.getAyah(nextPos.surah, nextPos.ayah) ?? null
      : null;

    // Flatten current ayah words with character positions
    let offset = 0;
    let charPos = 0;
    for (const w of this.currentAyah.words) {
      const charStart = charPos;
      const charEnd = charStart + w.textClean.length;
      this.scope.push({
        text: w.textClean,
        surah: this.currentAyah.surah,
        ayah: this.currentAyah.ayah,
        wordIndex: w.index,
        offset,
        charStart,
        charEnd,
      });
      charPos = charEnd;
      offset++;
    }

    // Flatten next ayah words
    if (this.nextAyah) {
      for (const w of this.nextAyah.words) {
        const charStart = charPos;
        const charEnd = charStart + w.textClean.length;
        this.scope.push({
          text: w.textClean,
          surah: this.nextAyah.surah,
          ayah: this.nextAyah.ayah,
          wordIndex: w.index,
          offset,
          charStart,
          charEnd,
        });
        charPos = charEnd;
        offset++;
      }
    }

    // Build concatenated character string
    this.scopeChars = this.scope.map(sw => sw.text).join('');

    // Set cursor offset and char position
    this.cursorOffset = this.scope.findIndex(
      sw =>
        sw.surah === this.cursor.surah &&
        sw.ayah === this.cursor.ayah &&
        sw.wordIndex === this.cursor.wordIndex,
    );
    if (this.cursorOffset < 0) this.cursorOffset = 0;
    this.cursorCharPos = this.scope[this.cursorOffset]?.charStart ?? 0;
  }

  /**
   * Find the best character-level match of `transcript` in scopeChars
   * starting from `fromCharPos`. Uses longest common substring to find
   * the densest overlap, tolerating insertions/deletions from Whisper.
   *
   * Returns the start and end character positions in scopeChars, or null.
   */
  private findBestCharMatch(
    transcript: string,
    fromCharPos: number,
  ): { startCharPos: number; endCharPos: number } | null {
    const scope = this.scopeChars;
    if (scope.length === 0 || transcript.length === 0) return null;

    // Search only from cursor position onward
    const searchScope = scope.slice(fromCharPos);
    if (searchScope.length === 0) return null;

    // Find the longest common substring between transcript and searchScope
    const tLen = transcript.length;
    const sLen = searchScope.length;

    // DP for longest common substring
    let bestLen = 0;
    let bestEndT = 0; // end index in transcript (1-based)
    let bestEndS = 0; // end index in searchScope (1-based)

    // Use a single row DP to save memory
    let prev = new Array(sLen + 1).fill(0);
    let curr = new Array(sLen + 1).fill(0);

    for (let i = 1; i <= tLen; i++) {
      for (let j = 1; j <= sLen; j++) {
        if (transcript[i - 1] === searchScope[j - 1]) {
          curr[j] = prev[j - 1] + 1;
          if (curr[j] > bestLen) {
            bestLen = curr[j];
            bestEndT = i;
            bestEndS = j;
          }
        } else {
          curr[j] = 0;
        }
      }
      [prev, curr] = [curr, prev];
      curr.fill(0);
    }

    // Check if the match is good enough
    if (bestLen < MIN_CHARS || bestLen / tLen < MIN_MATCH_RATIO) {
      return null;
    }

    // Map back to absolute scopeChars positions
    const matchStartInScope = fromCharPos + (bestEndS - bestLen);
    const matchEndInScope = fromCharPos + bestEndS - 1;

    return {
      startCharPos: matchStartInScope,
      endCharPos: matchEndInScope,
    };
  }

  /**
   * Map a character position in scopeChars back to the ScopeWord it belongs to.
   */
  private charPosToWord(charPos: number): ScopeWord | null {
    for (const sw of this.scope) {
      if (charPos >= sw.charStart && charPos < sw.charEnd) {
        return sw;
      }
    }
    // If charPos is at the very end, return last word
    if (this.scope.length > 0 && charPos >= this.scope[this.scope.length - 1].charStart) {
      return this.scope[this.scope.length - 1];
    }
    return null;
  }

  /**
   * Check if we've reached the end of the current ayah.
   * If so, shift scope forward and emit onAyahComplete.
   */
  private checkAyahCompletion(): void {
    if (!this.currentAyah) return;

    const lastWordIndex = this.currentAyah.words.length - 1;
    const cursorIsInCurrentAyah =
      this.cursor.surah === this.currentAyah.surah &&
      this.cursor.ayah === this.currentAyah.ayah;

    // Ayah is complete when cursor reaches or passes the last word
    if (cursorIsInCurrentAyah && this.cursor.wordIndex >= lastWordIndex) {
      this.callbacks.onAyahComplete?.({
        surah: this.currentAyah.surah,
        ayah: this.currentAyah.ayah,
      });

      // Shift: next ayah becomes current, load a new next
      this.advanceScope();
    } else if (!cursorIsInCurrentAyah) {
      // Cursor moved into the next ayah — current ayah is done
      this.callbacks.onAyahComplete?.({
        surah: this.currentAyah.surah,
        ayah: this.currentAyah.ayah,
      });
      this.advanceScope();
    }
  }

  /**
   * Shift the scope: current ayah = old next ayah, load new next ayah.
   */
  private advanceScope(): void {
    if (!this.nextAyah) {
      // No more ayahs — recitation complete
      this.status = 'completed';
      return;
    }

    // The cursor is now somewhere in what was the next ayah.
    // Rebuild scope starting from cursor position.
    this.rebuildScope();
  }

  /**
   * Get the next ayah position (surah, ayah) handling surah boundaries.
   */
  private getNextAyahPosition(
    surah: number,
    ayah: number,
  ): { surah: number; ayah: number } | null {
    const ayahCount = QuranDatabase.getAyahCount(surah);
    if (ayah < ayahCount) {
      return { surah, ayah: ayah + 1 };
    }
    // Next surah
    if (surah < 114) {
      return { surah: surah + 1, ayah: 1 };
    }
    return null; // end of Quran
  }
}
