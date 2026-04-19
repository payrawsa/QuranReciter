/**
 * RecitationTracker — tracks the user's position during Quran recitation.
 *
 * After QuranSearch locks the starting position, the tracker builds a scope
 * covering the current ayah + several ayahs ahead. It uses character-level
 * fuzzy matching (longest common substring) against the scope text to find
 * the user's position, tolerating Whisper transcription errors.
 *
 * As the user advances, the scope window shifts forward automatically.
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

/** Number of ayahs ahead of cursor to include in scope. */
const SCOPE_AYAHS_AHEAD = 2;

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

  // The flattened word list covering current + several ayahs ahead
  private scope: ScopeWord[] = [];
  // Concatenated normalized characters of all words in scope (no spaces)
  private scopeChars = '';
  // The offset within `scope` that corresponds to the cursor
  private cursorOffset = 0;
  // Character position of cursor in scopeChars
  private cursorCharPos = 0;
  // The first ayah in scope
  private scopeStartAyah: { surah: number; ayah: number } | null = null;
  // The last ayah in scope
  private scopeEndAyah: { surah: number; ayah: number } | null = null;

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
    this.scopeStartAyah = null;
    this.scopeEndAyah = null;
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

      // Detect ayah completion: if we moved to a different ayah, all
      // ayahs between prevPos and cursor (inclusive of prevPos's ayah)
      // have been completed.
      if (prevPos.surah !== this.cursor.surah || prevPos.ayah !== this.cursor.ayah) {
        let pos: { surah: number; ayah: number } | null = {
          surah: prevPos.surah,
          ayah: prevPos.ayah,
        };
        while (pos) {
          if (pos.surah === this.cursor.surah && pos.ayah === this.cursor.ayah) break;
          this.callbacks.onAyahComplete?.({ surah: pos.surah, ayah: pos.ayah });
          pos = this.getNextAyahPosition(pos.surah, pos.ayah);
        }
      }
    }

    // Check if scope needs extending
    this.ensureScopeAhead();
  }

  // ── Internal helpers ──────────────────────────────────────────────

  /**
   * Ensure the scope extends far enough ahead of the cursor.
   * If cursor is within 2 ayahs of the scope end, rebuild.
   */
  private ensureScopeAhead(): void {
    if (!this.scopeEndAyah) return;
    // Count how many ayahs remain between cursor and scope end
    let remaining = 0;
    let pos: { surah: number; ayah: number } | null = {
      surah: this.cursor.surah,
      ayah: this.cursor.ayah,
    };
    while (pos) {
      if (pos.surah === this.scopeEndAyah.surah && pos.ayah === this.scopeEndAyah.ayah) break;
      pos = this.getNextAyahPosition(pos.surah, pos.ayah);
      remaining++;
      if (remaining > SCOPE_AYAHS_AHEAD) break;
    }
    if (remaining <= 2) {
      this.rebuildScope();
    }
  }

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
   * Rebuild the flattened scope from the current cursor position,
   * loading SCOPE_AYAHS_AHEAD ayahs ahead. Computes character positions
   * and sets cursorOffset/cursorCharPos.
   */
  private rebuildScope(): void {
    this.scope = [];
    this.scopeChars = '';

    const startAyah = QuranDatabase.getAyah(this.cursor.surah, this.cursor.ayah);
    if (!startAyah) {
      this.status = 'completed';
      return;
    }

    this.scopeStartAyah = { surah: startAyah.surah, ayah: startAyah.ayah };

    // Collect current ayah + SCOPE_AYAHS_AHEAD more
    let offset = 0;
    let charPos = 0;
    let currentPos: { surah: number; ayah: number } | null = {
      surah: startAyah.surah,
      ayah: startAyah.ayah,
    };
    let ayahsLoaded = 0;

    while (currentPos && ayahsLoaded <= SCOPE_AYAHS_AHEAD) {
      const ayahData = QuranDatabase.getAyah(currentPos.surah, currentPos.ayah);
      if (!ayahData) break;

      for (const w of ayahData.words) {
        const charStart = charPos;
        const charEnd = charStart + w.textClean.length;
        this.scope.push({
          text: w.textClean,
          surah: ayahData.surah,
          ayah: ayahData.ayah,
          wordIndex: w.index,
          offset,
          charStart,
          charEnd,
        });
        charPos = charEnd;
        offset++;
      }

      this.scopeEndAyah = { surah: ayahData.surah, ayah: ayahData.ayah };
      currentPos = this.getNextAyahPosition(currentPos.surah, currentPos.ayah);
      ayahsLoaded++;
    }

    // Build concatenated character string
    this.scopeChars = this.scope.map(sw => sw.text).join('');

    // Set cursor offset and char position (use charEnd since we've already matched this word)
    this.cursorOffset = this.scope.findIndex(
      sw =>
        sw.surah === this.cursor.surah &&
        sw.ayah === this.cursor.ayah &&
        sw.wordIndex === this.cursor.wordIndex,
    );
    if (this.cursorOffset < 0) this.cursorOffset = 0;
    // Use charEnd if cursor word was already matched (rebuild case),
    // charStart if this is the initial build (word not yet matched).
    const cursorWord = this.scope[this.cursorOffset];
    const alreadyMatched = cursorWord
      ? this.wordStatuses.has(`${cursorWord.surah}:${cursorWord.ayah}:${cursorWord.wordIndex}`)
      : false;
    this.cursorCharPos = cursorWord
      ? (alreadyMatched ? cursorWord.charEnd : cursorWord.charStart)
      : 0;
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
