import { QuranSearch } from '../src/services/QuranSearch';
import { QuranDatabase } from '../src/services/QuranDatabase';

// Build the index once for all tests
beforeAll(() => {
  QuranSearch.buildIndex();
});

describe('QuranSearch', () => {
  describe('buildIndex', () => {
    it('builds an index with a large number of entries', () => {
      // Index was built in beforeAll, just verify it's ready
      expect(QuranSearch.isIndexReady()).toBe(true);
    });

    it('returns a positive count of trigram entries', () => {
      // Rebuild to check return value
      const count = QuranSearch.buildIndex();
      expect(count).toBeGreaterThan(50000);
    });
  });

  describe('findPosition', () => {
    it('finds Al-Fatiha ayah 1 from Bismillah words', () => {
      // "بسم الله الرحمن الرحيم" — first ayah of Al-Fatiha
      const words = ['بسم', 'الله', 'الرحمن', 'الرحيم'];
      const result = QuranSearch.findPosition(words);
      expect(result).not.toBeNull();
      expect(result!.position.surah).toBe(1);
      expect(result!.position.ayah).toBe(1);
      expect(result!.position.wordIndex).toBe(0);
      expect(result!.confidence).toBeGreaterThan(0);
    });

    it('finds Al-Fatiha ayah 2 from its words', () => {
      // "الحمد لله رب العلمين" — ayah 2 of Al-Fatiha
      const ayah = QuranDatabase.getAyah(1, 2)!;
      const words = ayah.words.map(w => w.textClean);
      const result = QuranSearch.findPosition(words);
      expect(result).not.toBeNull();
      expect(result!.position.surah).toBe(1);
      expect(result!.position.ayah).toBe(2);
      expect(result!.position.wordIndex).toBe(0);
    });

    it('finds position when starting mid-ayah', () => {
      // Take words 2-8 from Al-Baqarah ayah 255 (Ayat al-Kursi)
      // Use a wider slice to ensure uniqueness
      const ayah = QuranDatabase.getAyah(2, 255)!;
      const words = ayah.words.slice(2, 9).map(w => w.textClean);
      const result = QuranSearch.findPosition(words);
      expect(result).not.toBeNull();
      expect(result!.position.surah).toBe(2);
      expect(result!.position.ayah).toBe(255);
      expect(result!.position.wordIndex).toBe(2);
    });

    it('finds short surahs correctly (Al-Ikhlas)', () => {
      // Surah 112 Al-Ikhlas, ayah 1: "قل هو الله احد"
      const ayah = QuranDatabase.getAyah(112, 1)!;
      const words = ayah.words.map(w => w.textClean);
      const result = QuranSearch.findPosition(words);
      expect(result).not.toBeNull();
      expect(result!.position.surah).toBe(112);
      expect(result!.position.ayah).toBe(1);
    });

    it('finds position from Surah An-Nas', () => {
      // Last surah, ayah 1
      const ayah = QuranDatabase.getAyah(114, 1)!;
      const words = ayah.words.map(w => w.textClean);
      const result = QuranSearch.findPosition(words);
      expect(result).not.toBeNull();
      expect(result!.position.surah).toBe(114);
      expect(result!.position.ayah).toBe(1);
    });

    it('handles words with tashkeel (normalizes them)', () => {
      // Pass words WITH tashkeel — should still match
      const words = ['بِسْمِ', 'ٱللَّهِ', 'ٱلرَّحْمَٰنِ', 'ٱلرَّحِيمِ'];
      const result = QuranSearch.findPosition(words);
      expect(result).not.toBeNull();
      expect(result!.position.surah).toBe(1);
      expect(result!.position.ayah).toBe(1);
      expect(result!.position.wordIndex).toBe(0);
    });

    it('returns null if less than 3 words are given', () => {
      const result = QuranSearch.findPosition(['بسم', 'الله']);
      expect(result).toBeNull();
    });

    it('returns null for nonsense input', () => {
      const result = QuranSearch.findPosition(['xyz', 'abc', 'def']);
      expect(result).toBeNull();
    });

    it('is robust to one misrecognized word via voting', () => {
      // Al-Fatiha ayah 1 but with one garbled word
      // "بسم WRONG الرحمن الرحيم" — the trigrams "WRONG الرحمن الرحيم"
      // should still find the right position via voting across other windows
      const ayah = QuranDatabase.getAyah(1, 1)!;
      const words = ayah.words.map(w => w.textClean);
      words[1] = 'خطا'; // replace الله with garbage
      // Extend with ayah 2 words for more voting windows
      const ayah2 = QuranDatabase.getAyah(1, 2)!;
      words.push(...ayah2.words.map(w => w.textClean));
      const result = QuranSearch.findPosition(words);
      expect(result).not.toBeNull();
      expect(result!.position.surah).toBe(1);
      expect(result!.position.ayah).toBe(1);
    });

    it('crosses ayah boundaries when searching', () => {
      // Take last 2 words of Fatiha:1 + first 2 of Fatiha:2
      const a1 = QuranDatabase.getAyah(1, 1)!;
      const a2 = QuranDatabase.getAyah(1, 2)!;
      const words = [
        ...a1.words.slice(-2).map(w => w.textClean),
        ...a2.words.slice(0, 2).map(w => w.textClean),
      ];
      const result = QuranSearch.findPosition(words);
      expect(result).not.toBeNull();
      expect(result!.position.surah).toBe(1);
      // Should point to the start of the cross-boundary segment
      expect(result!.position.ayah).toBe(1);
      expect(result!.position.wordIndex).toBe(a1.words.length - 2);
    });

    it('has confidence of 1.0 for a perfect match', () => {
      // Use a long enough unique passage
      const ayah = QuranDatabase.getAyah(2, 255)!;
      const words = ayah.words.map(w => w.textClean);
      const result = QuranSearch.findPosition(words);
      expect(result).not.toBeNull();
      expect(result!.confidence).toBe(1.0);
    });
  });

  describe('clearIndex', () => {
    it('clears the index', () => {
      QuranSearch.clearIndex();
      expect(QuranSearch.isIndexReady()).toBe(false);
    });

    it('throws when findPosition called without index', () => {
      QuranSearch.clearIndex();
      expect(() => QuranSearch.findPosition(['بسم', 'الله', 'الرحمن'])).toThrow(
        'Index not built',
      );
      // Rebuild for any subsequent tests
      QuranSearch.buildIndex();
    });
  });
});
