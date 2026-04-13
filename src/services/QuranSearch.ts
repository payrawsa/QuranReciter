/**
 * QuranSearch — fuzzy n-gram based position detection for Quran recitation.
 *
 * Builds a sliding-window index of consecutive words across the entire Quran
 * so that a short transcript snippet can be matched to an exact position.
 * Uses edit distance for fuzzy word matching to tolerate Whisper transcription errors.
 */

import { QuranDatabase, type FlatWord } from './QuranDatabase';
import { normalizeArabic, editDistance } from '../utils/arabic';

export type WordPosition = {
  surah: number;
  ayah: number;
  wordIndex: number;
};

export type SearchResult = {
  position: WordPosition;
  confidence: number; // 0–1, fraction of transcript windows that matched
  matchCount: number; // number of n-gram windows that matched
  totalWindows: number; // total windows extracted from transcript
};

const NGRAM_SIZE = 3;

/** Max edit distance per word to count as a fuzzy match (relative to word length). */
const MAX_EDIT_DISTANCE_PER_WORD = 2;

/**
 * The search index. Built once from the Quran data, then reused.
 * Key: 3 consecutive normalized words joined by space.
 * Value: list of positions where that trigram starts.
 */
let trigramIndex: Map<string, WordPosition[]> | null = null;

/**
 * All unique trigram keys for fuzzy lookup.
 */
let trigramKeys: string[] | null = null;

/**
 * Build a sliding-window n-gram index over all Quran words.
 */
function buildNgramIndex(
  words: FlatWord[],
): Map<string, WordPosition[]> {
  const index = new Map<string, WordPosition[]>();

  for (let i = 0; i <= words.length - NGRAM_SIZE; i++) {
    const windowWords: string[] = [];
    let valid = true;

    for (let j = 0; j < NGRAM_SIZE; j++) {
      const w = words[i + j];
      windowWords.push(w.textClean);

      if (j > 0) {
        const prev = words[i + j - 1];
        const curr = words[i + j];
        const sameAyah =
          prev.surah === curr.surah && prev.ayah === curr.ayah;
        const nextAyahSameSurah =
          prev.surah === curr.surah &&
          curr.ayah === prev.ayah + 1 &&
          curr.index === 0;
        const nextSurah =
          curr.surah === prev.surah + 1 &&
          curr.ayah === 1 &&
          curr.index === 0;

        if (!sameAyah && !nextAyahSameSurah && !nextSurah) {
          valid = false;
          break;
        }
      }
    }

    if (!valid) continue;

    const key = windowWords.join(' ');
    const position: WordPosition = {
      surah: words[i].surah,
      ayah: words[i].ayah,
      wordIndex: words[i].index,
    };

    let positions = index.get(key);
    if (!positions) {
      positions = [];
      index.set(key, positions);
    }
    positions.push(position);
  }

  return index;
}

/**
 * Check if a transcript trigram fuzzy-matches a Quran trigram.
 * Each word must be within MAX_EDIT_DISTANCE_PER_WORD edits.
 */
function fuzzyTrigramMatch(transcriptWords: string[], quranKey: string): boolean {
  const quranWords = quranKey.split(' ');
  if (quranWords.length !== transcriptWords.length) return false;

  for (let i = 0; i < transcriptWords.length; i++) {
    const dist = editDistance(transcriptWords[i], quranWords[i]);
    if (dist > MAX_EDIT_DISTANCE_PER_WORD) return false;
  }
  return true;
}

export const QuranSearch = {
  /**
   * Build the n-gram index. Call once at app startup.
   * Returns the number of entries in the index.
   */
  buildIndex(): number {
    const allWords = QuranDatabase.getAllWords();
    trigramIndex = buildNgramIndex(allWords);
    trigramKeys = [...trigramIndex.keys()];
    return trigramIndex.size;
  },

  /**
   * Check if the index has been built.
   */
  isIndexReady(): boolean {
    return trigramIndex !== null;
  },

  /**
   * Find the most likely position in the Quran for the given transcript words.
   * Uses fuzzy word matching (edit distance) to tolerate Whisper errors.
   *
   * @param transcriptWords - Array of words from Whisper output (already normalized)
   * @returns Best match with confidence score, or null if no match found
   */
  findPosition(transcriptWords: string[]): SearchResult | null {
    if (!trigramIndex || !trigramKeys) {
      throw new Error('Index not built. Call buildIndex() first.');
    }

    const normalized = transcriptWords.map(w => normalizeArabic(w));

    if (normalized.length < NGRAM_SIZE) {
      return null;
    }

    // Extract trigram windows from transcript and find fuzzy matches
    const votes = new Map<string, number>();
    let totalWindows = 0;

    for (let i = 0; i <= normalized.length - NGRAM_SIZE; i++) {
      const window = normalized.slice(i, i + NGRAM_SIZE);
      totalWindows++;

      // First try exact match (fast path)
      const exactKey = window.join(' ');
      const exactMatches = trigramIndex.get(exactKey);
      if (exactMatches) {
        for (const pos of exactMatches) {
          const startPos = shiftPositionBack(pos, i);
          if (startPos) {
            const key = `${startPos.surah}:${startPos.ayah}:${startPos.wordIndex}`;
            votes.set(key, (votes.get(key) ?? 0) + 1);
          }
        }
        continue; // exact match found, no need for fuzzy
      }

      // Fuzzy match: check all trigram keys
      // Optimization: only check keys whose first word is close
      for (const quranKey of trigramKeys) {
        if (fuzzyTrigramMatch(window, quranKey)) {
          const positions = trigramIndex.get(quranKey)!;
          for (const pos of positions) {
            const startPos = shiftPositionBack(pos, i);
            if (startPos) {
              const key = `${startPos.surah}:${startPos.ayah}:${startPos.wordIndex}`;
              votes.set(key, (votes.get(key) ?? 0) + 1);
            }
          }
        }
      }
    }

    if (votes.size === 0) {
      return null;
    }

    // Find the top candidate by vote count
    const sorted = [...votes.entries()].sort((a, b) => b[1] - a[1]);
    const [bestKey, bestVoteCount] = sorted[0];
    const [surah, ayah, wordIndex] = bestKey.split(':').map(Number);

    return {
      position: { surah, ayah, wordIndex },
      confidence: bestVoteCount / totalWindows,
      matchCount: bestVoteCount,
      totalWindows,
    };
  },

  /**
   * Clear the index (useful for testing / memory management).
   */
  clearIndex(): void {
    trigramIndex = null;
    trigramKeys = null;
  },
};

/**
 * Shift a word position back by `count` words in the Quran.
 * Used to find the transcript start position from an n-gram match offset.
 */
function shiftPositionBack(
  pos: WordPosition,
  count: number,
): WordPosition | null {
  if (count === 0) return pos;

  // Walk backwards through the Quran word list
  let { surah, ayah, wordIndex } = pos;

  for (let i = 0; i < count; i++) {
    if (wordIndex > 0) {
      wordIndex--;
    } else {
      // Need to go to previous ayah
      const prevAyah = QuranDatabase.getAyah(surah, ayah - 1);
      if (prevAyah) {
        ayah = ayah - 1;
        wordIndex = prevAyah.words.length - 1;
      } else {
        // Previous surah
        const prevSurahNum = surah - 1;
        if (prevSurahNum < 1) return null;
        const prevSurahAyahCount = QuranDatabase.getAyahCount(prevSurahNum);
        if (prevSurahAyahCount === 0) return null;
        const lastAyah = QuranDatabase.getAyah(
          prevSurahNum,
          prevSurahAyahCount,
        );
        if (!lastAyah) return null;
        surah = prevSurahNum;
        ayah = prevSurahAyahCount;
        wordIndex = lastAyah.words.length - 1;
      }
    }
  }

  return { surah, ayah, wordIndex };
}
