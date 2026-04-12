import { QuranDatabase } from '../src/services/QuranDatabase';

describe('QuranDatabase', () => {
  describe('getAyah', () => {
    it('returns Al-Fatiha verse 1 (Bismillah)', () => {
      const ayah = QuranDatabase.getAyah(1, 1);
      expect(ayah).toBeDefined();
      expect(ayah!.surah).toBe(1);
      expect(ayah!.ayah).toBe(1);
      expect(ayah!.surahName).toBe('الفاتحة');
      expect(ayah!.text).toContain('بِسْمِ');
      expect(ayah!.words.length).toBe(4);
    });

    it('returns undefined for non-existent ayah', () => {
      expect(QuranDatabase.getAyah(1, 999)).toBeUndefined();
      expect(QuranDatabase.getAyah(999, 1)).toBeUndefined();
    });

    it('returns correct word-level data with tashkeel and clean text', () => {
      const ayah = QuranDatabase.getAyah(1, 1)!;
      expect(ayah.words[0].text).toBe('بِسْمِ');
      expect(ayah.words[0].textClean).toBe('بسم');
      expect(ayah.words[0].index).toBe(0);
    });
  });

  describe('getSurah', () => {
    it('returns all ayahs for Al-Fatiha (7 ayahs)', () => {
      const fatiha = QuranDatabase.getSurah(1);
      expect(fatiha.length).toBe(7);
      expect(fatiha[0].ayah).toBe(1);
      expect(fatiha[6].ayah).toBe(7);
    });

    it('returns empty array for non-existent surah', () => {
      expect(QuranDatabase.getSurah(999)).toEqual([]);
    });
  });

  describe('getSurahCount', () => {
    it('returns 114', () => {
      expect(QuranDatabase.getSurahCount()).toBe(114);
    });
  });

  describe('getAyahCount', () => {
    it('returns correct count for Al-Fatiha', () => {
      expect(QuranDatabase.getAyahCount(1)).toBe(7);
    });

    it('returns correct count for Al-Baqarah', () => {
      expect(QuranDatabase.getAyahCount(2)).toBe(286);
    });

    it('returns 0 for non-existent surah', () => {
      expect(QuranDatabase.getAyahCount(999)).toBe(0);
    });
  });

  describe('getSurahName', () => {
    it('returns correct surah name', () => {
      expect(QuranDatabase.getSurahName(1)).toBe('الفاتحة');
      expect(QuranDatabase.getSurahName(2)).toBe('البقرة');
      expect(QuranDatabase.getSurahName(114)).toBe('الناس');
    });
  });

  describe('getWordAt', () => {
    it('returns the correct word', () => {
      const word = QuranDatabase.getWordAt(1, 1, 1);
      expect(word).toBeDefined();
      expect(word!.textClean).toBe('الله');
    });

    it('returns undefined for out-of-range word index', () => {
      expect(QuranDatabase.getWordAt(1, 1, 100)).toBeUndefined();
    });
  });

  describe('getAllWords', () => {
    it('returns a large flat array of all words', () => {
      const allWords = QuranDatabase.getAllWords();
      expect(allWords.length).toBeGreaterThan(77000);
      expect(allWords[0].surah).toBe(1);
      expect(allWords[0].ayah).toBe(1);
      expect(allWords[0].textClean).toBe('بسم');
    });
  });

  describe('getNextWordPosition', () => {
    it('advances within the same ayah', () => {
      const next = QuranDatabase.getNextWordPosition(1, 1, 0);
      expect(next).toEqual({ surah: 1, ayah: 1, wordIndex: 1 });
    });

    it('advances to next ayah when at end of current ayah', () => {
      const fatiha1 = QuranDatabase.getAyah(1, 1)!;
      const lastWordIndex = fatiha1.words.length - 1;
      const next = QuranDatabase.getNextWordPosition(1, 1, lastWordIndex);
      expect(next).toEqual({ surah: 1, ayah: 2, wordIndex: 0 });
    });

    it('advances to next surah when at end of current surah', () => {
      const lastAyah = QuranDatabase.getAyahCount(1);
      const lastAyahData = QuranDatabase.getAyah(1, lastAyah)!;
      const lastWordIndex = lastAyahData.words.length - 1;
      const next = QuranDatabase.getNextWordPosition(1, lastAyah, lastWordIndex);
      expect(next).toEqual({ surah: 2, ayah: 1, wordIndex: 0 });
    });

    it('returns undefined at end of Quran', () => {
      const lastAyah = QuranDatabase.getAyahCount(114);
      const lastAyahData = QuranDatabase.getAyah(114, lastAyah)!;
      const lastWordIndex = lastAyahData.words.length - 1;
      const next = QuranDatabase.getNextWordPosition(114, lastAyah, lastWordIndex);
      expect(next).toBeUndefined();
    });
  });
});
