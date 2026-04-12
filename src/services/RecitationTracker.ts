/**
 * RecitationTracker — tracks the user's position during Quran recitation.
 *
 * After Phase 2 (QuranSearch) locks the starting position, the tracker
 * narrows scope to *current ayah + next ayah* only. It uses a 3-word
 * sliding window from the transcript to find the user's position within
 * that scope, always picking the nearest forward match from the cursor.
 *
 * As the user completes an ayah the window shifts forward automatically.
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

export type PositionChangeEvent = {
  previous: WordPosition;
  current: WordPosition;
};

export type AyahCompleteEvent = {
  surah: number;
  ayah: number;
};

export type TrackerCallbacks = {
  onPositionChange?: (event: PositionChangeEvent) => void;
  onAyahComplete?: (event: AyahCompleteEvent) => void;
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

  // The flattened word list covering current + next ayah
  private scope: ScopeWord[] = [];
  // The offset within `scope` that corresponds to the cursor
  private cursorOffset = 0;
  // The ayah numbers currently in scope
  private currentAyah: AyahData | null = null;
  private nextAyah: AyahData | null = null;

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

    const prevPos = { ...this.cursor };
    this.cursor = {
      surah: newWord.surah,
      ayah: newWord.ayah,
      wordIndex: newWord.wordIndex,
    };
    this.cursorOffset = newOffset;

    // Emit position change
    if (
      prevPos.surah !== this.cursor.surah ||
      prevPos.ayah !== this.cursor.ayah ||
      prevPos.wordIndex !== this.cursor.wordIndex
    ) {
      this.callbacks.onPositionChange?.({
        previous: prevPos,
        current: { ...this.cursor },
      });
    }

    // Check if the current ayah is completed
    this.checkAyahCompletion();
  }

  // ── Internal helpers ──────────────────────────────────────────────

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
