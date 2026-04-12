/**
 * RecitationTracker — tracks the user's position during Quran recitation.
 *
 * After Phase 2 (QuranSearch) locks the starting position, the tracker
 * narrows scope to *current ayah + next ayah* only. It uses a 3-word
 * sliding window from the transcript to find the user's position within
 * that scope, always picking the nearest forward match from the cursor.
 *
 * As the user completes an ayah the window shifts forward automatically.
 * Skipped words (and skipped ayahs) are detected and recorded as errors.
 */

import { QuranDatabase, type AyahData, type QuranWord } from './QuranDatabase';
import { normalizeArabic } from '../utils/arabic';

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

const WINDOW_SIZE = 3; // 3-word sliding window

// ── Internal: flattened word list for the search scope ─────────────

type ScopeWord = {
  text: string; // normalized (clean) text
  surah: number;
  ayah: number;
  wordIndex: number;
  /** Linear offset within the scope (0-based) */
  offset: number;
};

// ── Tracker ───────────────────────────────────────────────────────────

export class RecitationTracker {
  private status: TrackingStatus = 'idle';
  private cursor: WordPosition = { surah: 0, ayah: 0, wordIndex: 0 };
  private callbacks: TrackerCallbacks = {};
  private errors: RecitationError[] = [];

  // The flattened word list covering current + next ayah
  private scope: ScopeWord[] = [];
  // The offset within `scope` that corresponds to the cursor
  private cursorOffset = 0;
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
    this.cursorOffset = 0;
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
   * Feed new transcript words from Whisper.  The tracker extracts the
   * last 3 words, searches within the current+next ayah scope,
   * and advances the cursor to the nearest forward match.
   *
   * @param words — array of raw transcript words (will be normalized)
   */
  processWords(words: string[]): void {
    if (this.status !== 'tracking' || words.length < WINDOW_SIZE) {
      return;
    }

    const normalized = words.map(w => normalizeArabic(w));

    // Extract the last 3-word window from the transcript
    const window = normalized.slice(-WINDOW_SIZE);
    const windowKey = window.join(' ');

    // Find all matching positions in scope from cursor onward
    const matches = this.findWindowMatches(windowKey);

    if (matches.length === 0) {
      return; // no match — cursor stays
    }

    // Pick the nearest forward match (smallest offset ≥ cursorOffset)
    const best = matches[0]; // already sorted nearest-first by findWindowMatches

    // Advance cursor to the END of the matched window (last word of trigram)
    const newOffset = best.offset + WINDOW_SIZE - 1;
    const newWord = this.scope[newOffset];
    if (!newWord) return;

    // ── Detect skipped words between old cursor and the match start ──
    const skippedWords = this.detectSkippedWords(
      this.cursorOffset,
      best.offset,
    );

    // Mark the matched words as correct
    for (let i = best.offset; i <= newOffset; i++) {
      const sw = this.scope[i];
      this.wordStatuses.set(
        `${sw.surah}:${sw.ayah}:${sw.wordIndex}`,
        'correct',
      );
    }

    const prevPos = { ...this.cursor };
    this.cursor = {
      surah: newWord.surah,
      ayah: newWord.ayah,
      wordIndex: newWord.wordIndex,
    };
    this.cursorOffset = newOffset;

    // Emit position change (includes skipped words info)
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
   * Rebuild the flattened scope from the current ayah + next ayah
   * and set cursorOffset to match the cursor position.
   */
  private rebuildScope(): void {
    this.scope = [];

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

    // Flatten current ayah words
    let offset = 0;
    for (const w of this.currentAyah.words) {
      this.scope.push({
        text: w.textClean,
        surah: this.currentAyah.surah,
        ayah: this.currentAyah.ayah,
        wordIndex: w.index,
        offset,
      });
      offset++;
    }

    // Flatten next ayah words
    if (this.nextAyah) {
      for (const w of this.nextAyah.words) {
        this.scope.push({
          text: w.textClean,
          surah: this.nextAyah.surah,
          ayah: this.nextAyah.ayah,
          wordIndex: w.index,
          offset,
        });
        offset++;
      }
    }

    // Set cursor offset
    this.cursorOffset = this.scope.findIndex(
      sw =>
        sw.surah === this.cursor.surah &&
        sw.ayah === this.cursor.ayah &&
        sw.wordIndex === this.cursor.wordIndex,
    );
    if (this.cursorOffset < 0) this.cursorOffset = 0;
  }

  /**
   * Search the scope for all positions where `windowKey` matches,
   * only at offsets ≥ cursorOffset, sorted nearest-first.
   */
  private findWindowMatches(windowKey: string): ScopeWord[] {
    const results: ScopeWord[] = [];

    // Only search from cursor offset onward (forward matches)
    const maxStart = this.scope.length - WINDOW_SIZE;
    for (let i = this.cursorOffset; i <= maxStart; i++) {
      const candidate = this.scope
        .slice(i, i + WINDOW_SIZE)
        .map(sw => sw.text)
        .join(' ');

      if (candidate === windowKey) {
        results.push(this.scope[i]);
      }
    }

    return results; // already in offset order (nearest first)
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
