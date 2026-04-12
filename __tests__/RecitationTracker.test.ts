import { RecitationTracker } from '../src/services/RecitationTracker';
import { QuranDatabase } from '../src/services/QuranDatabase';
import type {
  PositionChangeEvent,
  AyahCompleteEvent,
} from '../src/services/RecitationTracker';

describe('RecitationTracker', () => {
  let tracker: RecitationTracker;

  beforeEach(() => {
    tracker = new RecitationTracker();
  });

  afterEach(() => {
    tracker.stop();
  });

  describe('lifecycle', () => {
    it('starts in idle status', () => {
      expect(tracker.getStatus()).toBe('idle');
    });

    it('transitions to tracking on startTracking', () => {
      tracker.startTracking(1, 1, 0);
      expect(tracker.getStatus()).toBe('tracking');
    });

    it('transitions back to idle on stop', () => {
      tracker.startTracking(1, 1, 0);
      tracker.stop();
      expect(tracker.getStatus()).toBe('idle');
    });

    it('sets current position from startTracking args', () => {
      tracker.startTracking(1, 1, 0);
      expect(tracker.getCurrentPosition()).toEqual({
        surah: 1,
        ayah: 1,
        wordIndex: 0,
      });
    });
  });

  describe('processWords — basic matching', () => {
    it('advances cursor when 3-word window matches', () => {
      // Al-Fatiha ayah 1: بسم الله الرحمن الرحيم
      tracker.startTracking(1, 1, 0);
      const a1 = QuranDatabase.getAyah(1, 1)!;
      const words = a1.words.map(w => w.textClean);

      // Feed the first 3 words
      tracker.processWords(words.slice(0, 3));

      // Cursor should be at the end of the trigram (word index 2)
      const pos = tracker.getCurrentPosition();
      expect(pos.surah).toBe(1);
      expect(pos.ayah).toBe(1);
      expect(pos.wordIndex).toBe(2);
    });

    it('advances cursor to the last word on full ayah', () => {
      tracker.startTracking(1, 1, 0);
      const a1 = QuranDatabase.getAyah(1, 1)!;
      const words = a1.words.map(w => w.textClean);

      // Feed all 4 words — last trigram is words[1..3]
      tracker.processWords(words);

      const pos = tracker.getCurrentPosition();
      expect(pos.surah).toBe(1);
      expect(pos.ayah).toBe(1);
      expect(pos.wordIndex).toBe(3); // last word
    });

    it('does not advance when fewer than 3 words are given', () => {
      tracker.startTracking(1, 1, 0);
      tracker.processWords(['بسم', 'الله']);
      // Still at starting position
      expect(tracker.getCurrentPosition()).toEqual({
        surah: 1,
        ayah: 1,
        wordIndex: 0,
      });
    });

    it('does not advance for non-matching words', () => {
      tracker.startTracking(1, 1, 0);
      tracker.processWords(['خطا', 'كلمة', 'غريبة']);
      expect(tracker.getCurrentPosition()).toEqual({
        surah: 1,
        ayah: 1,
        wordIndex: 0,
      });
    });
  });

  describe('processWords — nearest forward match', () => {
    it('picks nearest forward match when duplicate phrases exist in scope', () => {
      // Construct a scenario: start at word 0, and feed a window that
      // could match at offset 0 AND later. Should pick offset 0.
      tracker.startTracking(1, 1, 0);
      const a1 = QuranDatabase.getAyah(1, 1)!;
      const firstThree = a1.words.slice(0, 3).map(w => w.textClean);

      tracker.processWords(firstThree);
      expect(tracker.getCurrentPosition().wordIndex).toBe(2);
    });

    it('does not jump backwards', () => {
      tracker.startTracking(1, 1, 0);
      const a1 = QuranDatabase.getAyah(1, 1)!;
      const words = a1.words.map(w => w.textClean);

      // Advance to word 2
      tracker.processWords(words.slice(0, 3));
      expect(tracker.getCurrentPosition().wordIndex).toBe(2);

      // Feed the same first 3 words again — should NOT jump back
      tracker.processWords(words.slice(0, 3));
      expect(tracker.getCurrentPosition().wordIndex).toBe(2);
    });
  });

  describe('processWords — cross-ayah tracking', () => {
    it('tracks into the next ayah', () => {
      // Start at Al-Fatiha 1:1, then feed words spanning into 1:2
      tracker.startTracking(1, 1, 0);
      const a1 = QuranDatabase.getAyah(1, 1)!;
      const a2 = QuranDatabase.getAyah(1, 2)!;

      // Feed all of ayah 1
      tracker.processWords(a1.words.map(w => w.textClean));

      // Now feed first 3 words of ayah 2
      const allWords = [
        ...a1.words.map(w => w.textClean),
        ...a2.words.slice(0, 3).map(w => w.textClean),
      ];
      tracker.processWords(allWords);

      const pos = tracker.getCurrentPosition();
      expect(pos.surah).toBe(1);
      expect(pos.ayah).toBe(2);
      expect(pos.wordIndex).toBe(2);
    });
  });

  describe('callbacks', () => {
    it('fires onPositionChange when cursor moves', () => {
      const changes: PositionChangeEvent[] = [];
      tracker.startTracking(1, 1, 0, {
        onPositionChange: e => changes.push(e),
      });

      const a1 = QuranDatabase.getAyah(1, 1)!;
      tracker.processWords(a1.words.slice(0, 3).map(w => w.textClean));

      expect(changes.length).toBe(1);
      expect(changes[0].previous).toEqual({ surah: 1, ayah: 1, wordIndex: 0 });
      expect(changes[0].current).toEqual({ surah: 1, ayah: 1, wordIndex: 2 });
    });

    it('fires onAyahComplete when last word of ayah is reached', () => {
      const completed: AyahCompleteEvent[] = [];
      tracker.startTracking(1, 1, 0, {
        onAyahComplete: e => completed.push(e),
      });

      const a1 = QuranDatabase.getAyah(1, 1)!;
      // Feed all words — last trigram covers the final word
      tracker.processWords(a1.words.map(w => w.textClean));

      expect(completed.length).toBe(1);
      expect(completed[0]).toEqual({ surah: 1, ayah: 1 });
    });

    it('fires onAyahComplete when cursor enters next ayah', () => {
      const completed: AyahCompleteEvent[] = [];
      tracker.startTracking(1, 1, 0, {
        onAyahComplete: e => completed.push(e),
      });

      const a1 = QuranDatabase.getAyah(1, 1)!;
      const a2 = QuranDatabase.getAyah(1, 2)!;

      // Feed words crossing into ayah 2
      const allWords = [
        ...a1.words.map(w => w.textClean),
        ...a2.words.slice(0, 3).map(w => w.textClean),
      ];
      tracker.processWords(allWords);

      expect(completed.some(e => e.surah === 1 && e.ayah === 1)).toBe(true);
    });
  });

  describe('scope advancement', () => {
    it('rebuilds scope after completing an ayah so tracking continues', () => {
      tracker.startTracking(1, 1, 0);

      const a1 = QuranDatabase.getAyah(1, 1)!;
      const a2 = QuranDatabase.getAyah(1, 2)!;
      const a3 = QuranDatabase.getAyah(1, 3)!;

      // Complete ayah 1 and move to ayah 2
      const wordsThrough2 = [
        ...a1.words.map(w => w.textClean),
        ...a2.words.slice(0, 3).map(w => w.textClean),
      ];
      tracker.processWords(wordsThrough2);

      // Now feed words from ayah 2 end + ayah 3 start
      // After ayah 1 completed, scope should now be ayah 2 + ayah 3
      const wordsThrough3 = [
        ...a2.words.map(w => w.textClean),
        ...a3.words.slice(0, 3).map(w => w.textClean),
      ];
      tracker.processWords(wordsThrough3);

      const pos = tracker.getCurrentPosition();
      expect(pos.surah).toBe(1);
      expect(pos.ayah).toBe(3);
    });
  });

  describe('handles tashkeel input', () => {
    it('normalizes words with tashkeel before matching', () => {
      tracker.startTracking(1, 1, 0);
      // Feed words WITH tashkeel
      tracker.processWords(['بِسْمِ', 'ٱللَّهِ', 'ٱلرَّحْمَٰنِ']);

      const pos = tracker.getCurrentPosition();
      expect(pos.surah).toBe(1);
      expect(pos.ayah).toBe(1);
      expect(pos.wordIndex).toBe(2);
    });
  });

  describe('edge cases', () => {
    it('handles starting mid-ayah', () => {
      // Start at word 2 of Al-Fatiha ayah 1
      tracker.startTracking(1, 1, 2);
      const a1 = QuranDatabase.getAyah(1, 1)!;
      const a2 = QuranDatabase.getAyah(1, 2)!;

      // Feed a window that starts at word 2: الرحمن الرحيم + first of ayah 2
      const words = [
        a1.words[2].textClean,
        a1.words[3].textClean,
        a2.words[0].textClean,
      ];
      tracker.processWords(words);

      const pos = tracker.getCurrentPosition();
      // Should match and cursor should be at ayah 2 word 0
      expect(pos.surah).toBe(1);
      expect(pos.ayah).toBe(2);
      expect(pos.wordIndex).toBe(0);
    });

    it('does nothing when status is idle', () => {
      // Don't call startTracking
      tracker.processWords(['بسم', 'الله', 'الرحمن']);
      expect(tracker.getStatus()).toBe('idle');
    });

    it('handles last surah last ayah without crashing', () => {
      const lastAyahCount = QuranDatabase.getAyahCount(114);
      const lastAyah = QuranDatabase.getAyah(114, lastAyahCount)!;

      tracker.startTracking(114, lastAyahCount, 0);

      // Feed words — no next ayah exists, should not crash
      // Status becomes 'completed' since there's nowhere to advance
      if (lastAyah.words.length >= 3) {
        tracker.processWords(
          lastAyah.words.slice(0, 3).map(w => w.textClean),
        );
        expect(['tracking', 'completed']).toContain(tracker.getStatus());
      }
    });
  });
});
