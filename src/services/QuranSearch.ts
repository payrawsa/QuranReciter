/**
 * QuranSearch — n-gram based position detection for Quran recitation.
 *
 * Builds a sliding-window index of consecutive words across the entire Quran
 * so that a short transcript snippet can be matched to an exact position.
 */

import { QuranDatabase, type FlatWord } from './QuranDatabase';
import { normalizeArabic } from '../utils/arabic';

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

// N-gram sizes to use. 3-grams for recall, 5-grams for precision on ambiguous phrases.
const NGRAM_SIZE_PRIMARY = 3;
const NGRAM_SIZE_DISAMBIG = 5;

/**
 * The search index. Built once from the Quran data, then reused.
 */
let trigramIndex: Map<string, WordPosition[]> | null = null;
let pentagramIndex: Map<string, WordPosition[]> | null = null;

/**
 * Build a sliding-window n-gram index over all Quran words.
 * Each key is n consecutive normalized words joined by space.
 * Each value is the list of positions where that n-gram starts.
 */
function buildNgramIndex(
  words: FlatWord[],
  n: number,
): Map<string, WordPosition[]> {
  const index = new Map<string, WordPosition[]>();

  for (let i = 0; i <= words.length - n; i++) {
    // Only build n-grams within contiguous sequences — don't span surah boundaries
    // Check that all n words are consecutive (same ayah, or sequential ayah transitions)
    const windowWords: string[] = [];
    let valid = true;

    for (let j = 0; j < n; j++) {
      const w = words[i + j];
      windowWords.push(w.textClean);

      // Check continuity: each word should follow the previous one
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

export const QuranSearch = {
  /**
   * Build the n-gram indices. Call once at app startup.
   * Returns the number of entries in the primary index.
   */
  buildIndex(): number {
    const allWords = QuranDatabase.getAllWords();
    trigramIndex = buildNgramIndex(allWords, NGRAM_SIZE_PRIMARY);
    pentagramIndex = buildNgramIndex(allWords, NGRAM_SIZE_DISAMBIG);
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
   *
   * @param transcriptWords - Array of words from Whisper output (will be normalized)
   * @returns Best match with confidence score, or null if no match found
   */
  findPosition(transcriptWords: string[]): SearchResult | null {
    if (!trigramIndex || !pentagramIndex) {
      throw new Error('Index not built. Call buildIndex() first.');
    }

    // Normalize all transcript words
    const normalized = transcriptWords.map(w => normalizeArabic(w));

    if (normalized.length < NGRAM_SIZE_PRIMARY) {
      return null; // Not enough words to form even one trigram
    }

    // Step 1: Extract trigram windows and look up each one
    const votes = new Map<string, number>(); // "surah:ayah:wordIndex" → vote count
    let totalWindows = 0;

    for (let i = 0; i <= normalized.length - NGRAM_SIZE_PRIMARY; i++) {
      const window = normalized.slice(i, i + NGRAM_SIZE_PRIMARY).join(' ');
      const matches = trigramIndex.get(window);
      totalWindows++;

      if (matches) {
        for (const pos of matches) {
          // Vote for the position that would be the START of the transcript
          // If this trigram is at offset i in the transcript, the transcript
          // start position is `pos` shifted back by i words
          const startPos = shiftPositionBack(pos, i);
          if (startPos) {
            const key = `${startPos.surah}:${startPos.ayah}:${startPos.wordIndex}`;
            votes.set(key, (votes.get(key) ?? 0) + 1);
          }
        }
      }
    }

    if (votes.size === 0) {
      return null;
    }

    // Step 2: Find the top candidates by vote count
    const sorted = [...votes.entries()].sort((a, b) => b[1] - a[1]);
    const topVotes = sorted[0][1];

    // If there are ties, try disambiguating with 5-grams
    const topCandidates = sorted.filter(([, v]) => v === topVotes);

    let bestKey = topCandidates[0][0];
    let bestVoteCount = topVotes;

    if (topCandidates.length > 1 && normalized.length >= NGRAM_SIZE_DISAMBIG) {
      // Use 5-grams to break ties
      let bestPentaVotes = -1;

      for (const [candidateKey] of topCandidates) {
        const [s, a, w] = candidateKey.split(':').map(Number);
        let pentaVoteCount = 0;

        for (let i = 0; i <= normalized.length - NGRAM_SIZE_DISAMBIG; i++) {
          const window = normalized
            .slice(i, i + NGRAM_SIZE_DISAMBIG)
            .join(' ');
          const matches = pentagramIndex.get(window);
          if (matches) {
            for (const pos of matches) {
              const startPos = shiftPositionBack(pos, i);
              if (
                startPos &&
                startPos.surah === s &&
                startPos.ayah === a &&
                startPos.wordIndex === w
              ) {
                pentaVoteCount++;
              }
            }
          }
        }

        if (pentaVoteCount > bestPentaVotes) {
          bestPentaVotes = pentaVoteCount;
          bestKey = candidateKey;
        }
      }
    }

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
    pentagramIndex = null;
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
