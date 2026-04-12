/**
 * QuranDatabase — provides lookup methods over the pre-processed Quran JSON.
 *
 * The JSON is bundled with the app and loaded once at startup.
 */

import quranData from '../data/quran.json';

export type QuranWord = {
  index: number;
  text: string;
  textClean: string;
};

export type AyahData = {
  surah: number;
  surahName: string;
  ayah: number;
  text: string;
  words: QuranWord[];
};

export type FlatWord = QuranWord & {
  surah: number;
  ayah: number;
};

// Cast the imported JSON to our typed array
const ayahs: AyahData[] = quranData as AyahData[];

// Pre-build indices for fast lookups
const surahAyahMap = new Map<string, AyahData>();
const surahMap = new Map<number, AyahData[]>();

for (const ayah of ayahs) {
  surahAyahMap.set(`${ayah.surah}:${ayah.ayah}`, ayah);

  let arr = surahMap.get(ayah.surah);
  if (!arr) {
    arr = [];
    surahMap.set(ayah.surah, arr);
  }
  arr.push(ayah);
}

export const QuranDatabase = {
  /**
   * Get a specific ayah by surah and ayah number.
   * Returns undefined if not found.
   */
  getAyah(surah: number, ayah: number): AyahData | undefined {
    return surahAyahMap.get(`${surah}:${ayah}`);
  },

  /**
   * Get all ayahs in a surah.
   * Returns empty array if surah not found.
   */
  getSurah(surah: number): AyahData[] {
    return surahMap.get(surah) ?? [];
  },

  /**
   * Get the name of a surah.
   */
  getSurahName(surah: number): string | undefined {
    const ayahsInSurah = surahMap.get(surah);
    return ayahsInSurah?.[0]?.surahName;
  },

  /**
   * Get total number of surahs (114).
   */
  getSurahCount(): number {
    return surahMap.size;
  },

  /**
   * Get the number of ayahs in a surah.
   */
  getAyahCount(surah: number): number {
    return surahMap.get(surah)?.length ?? 0;
  },

  /**
   * Get a single word at a specific position.
   */
  getWordAt(
    surah: number,
    ayah: number,
    wordIndex: number,
  ): QuranWord | undefined {
    const ayahData = surahAyahMap.get(`${surah}:${ayah}`);
    return ayahData?.words[wordIndex];
  },

  /**
   * Get a flat array of all words across the entire Quran,
   * each tagged with surah/ayah metadata.
   * Useful for building search indices.
   */
  getAllWords(): FlatWord[] {
    const result: FlatWord[] = [];
    for (const ayah of ayahs) {
      for (const word of ayah.words) {
        result.push({
          ...word,
          surah: ayah.surah,
          ayah: ayah.ayah,
        });
      }
    }
    return result;
  },

  /**
   * Get all ayah data (the raw array).
   */
  getAllAyahs(): AyahData[] {
    return ayahs;
  },

  /**
   * Get the next word position after the given one.
   * Handles ayah and surah boundaries.
   * Returns undefined if at the very end of the Quran.
   */
  getNextWordPosition(
    surah: number,
    ayah: number,
    wordIndex: number,
  ): { surah: number; ayah: number; wordIndex: number } | undefined {
    const currentAyah = surahAyahMap.get(`${surah}:${ayah}`);
    if (!currentAyah) return undefined;

    // Next word in same ayah
    if (wordIndex + 1 < currentAyah.words.length) {
      return { surah, ayah, wordIndex: wordIndex + 1 };
    }

    // Next ayah in same surah
    const nextAyah = surahAyahMap.get(`${surah}:${ayah + 1}`);
    if (nextAyah) {
      return { surah, ayah: ayah + 1, wordIndex: 0 };
    }

    // First ayah of next surah
    const nextSurah = surahMap.get(surah + 1);
    if (nextSurah && nextSurah.length > 0) {
      return { surah: surah + 1, ayah: 1, wordIndex: 0 };
    }

    // End of Quran
    return undefined;
  },
};
