import { stripTashkeel, normalizeArabic, splitArabicWords } from '../src/utils/arabic';

describe('stripTashkeel', () => {
  it('removes fatha, kasra, damma, sukun, shadda', () => {
    // بِسْمِ → بسم
    expect(stripTashkeel('بِسْمِ')).toBe('بسم');
  });

  it('removes tanween (fathatan, kasratan, dammatan)', () => {
    expect(stripTashkeel('كِتَابًا')).toBe('كتابا');
  });

  it('removes shadda', () => {
    // ٱلرَّحْمَٰنِ → ٱلرحمٰن
    expect(stripTashkeel('ٱللَّهِ')).toBe('ٱلله');
  });

  it('handles text with no tashkeel', () => {
    expect(stripTashkeel('بسم')).toBe('بسم');
  });

  it('handles empty string', () => {
    expect(stripTashkeel('')).toBe('');
  });

  it('handles mixed Arabic and spaces', () => {
    expect(stripTashkeel('بِسْمِ ٱللَّهِ')).toBe('بسم ٱلله');
  });
});

describe('normalizeArabic', () => {
  it('strips tashkeel and normalizes alef variants', () => {
    // أ → ا, إ → ا, آ → ا, ٱ → ا
    expect(normalizeArabic('أَحَدٌ')).toBe('احد');
    expect(normalizeArabic('إِيَّاكَ')).toBe('اياك');
    expect(normalizeArabic('ٱلْحَمْدُ')).toBe('الحمد');
  });

  it('normalizes taa marbuta to haa', () => {
    expect(normalizeArabic('رَحْمَةٌ')).toBe('رحمه');
  });

  it('normalizes alef maqsura to yaa', () => {
    expect(normalizeArabic('عَلَى')).toBe('علي');
  });

  it('removes tatweel', () => {
    expect(normalizeArabic('اللـه')).toBe('الله');
  });

  it('collapses whitespace', () => {
    expect(normalizeArabic('بسم   الله')).toBe('بسم الله');
  });

  it('handles empty string', () => {
    expect(normalizeArabic('')).toBe('');
  });

  it('normalizes a full ayah', () => {
    const input = 'بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ';
    const expected = 'بسم الله الرحمن الرحيم';
    expect(normalizeArabic(input)).toBe(expected);
  });
});

describe('splitArabicWords', () => {
  it('splits on whitespace', () => {
    expect(splitArabicWords('بسم الله الرحمن الرحيم')).toEqual([
      'بسم', 'الله', 'الرحمن', 'الرحيم',
    ]);
  });

  it('handles multiple spaces', () => {
    expect(splitArabicWords('بسم   الله')).toEqual(['بسم', 'الله']);
  });

  it('handles empty string', () => {
    expect(splitArabicWords('')).toEqual([]);
  });

  it('handles single word', () => {
    expect(splitArabicWords('بسم')).toEqual(['بسم']);
  });
});
