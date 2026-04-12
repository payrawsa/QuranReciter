/**
 * Arabic text utilities for Quran text matching.
 *
 * Whisper outputs Arabic without tashkeel (diacritics), while Quran text has
 * full tashkeel. These utilities normalize text for comparison.
 */

// Unicode ranges for Arabic tashkeel (diacritical marks / harakat)
// \u0610-\u061A: Various Arabic marks (e.g. ARABIC SIGN SALLALLAHOU ALAYHE WASSALLAM)
// \u064B-\u065F: Core harakat (fathatan, kasratan, dammatan, fatha, kasra, damma, sukun, shadda, etc.)
// \u0670: ARABIC LETTER SUPERSCRIPT ALEF
// \u06D6-\u06DC: Small recitation marks (Quran-specific)
// \u06DF-\u06E4: Additional Quran marks
// \u06E7-\u06E8: More marks
// \u06EA-\u06ED: Additional combining marks
const TASHKEEL_REGEX =
  /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06DC\u06DF-\u06E4\u06E7-\u06E8\u06EA-\u06ED]/g;

/**
 * Remove tashkeel (diacritical marks) from Arabic text.
 * "بِسْمِ" → "بسم"
 */
export function stripTashkeel(text: string): string {
  return text.replace(TASHKEEL_REGEX, '');
}

/**
 * Normalize Arabic text for fuzzy matching:
 * - Strip tashkeel
 * - Normalize alef variants (أ إ آ ٱ → ا)
 * - Normalize taa marbuta → haa (ة → ه)
 * - Normalize alef maqsura → yaa (ى → ي)
 * - Remove tatweel/kashida (ـ)
 * - Collapse whitespace
 */
export function normalizeArabic(text: string): string {
  let result = stripTashkeel(text);

  // Normalize alef variants: أ (U+0623), إ (U+0625), آ (U+0622), ٱ (U+0671) → ا (U+0627)
  result = result.replace(/[أإآٱ]/g, 'ا');

  // Normalize taa marbuta → haa: ة (U+0629) → ه (U+0647)
  result = result.replace(/ة/g, 'ه');

  // Normalize alef maqsura → yaa: ى (U+0649) → ي (U+064A)
  result = result.replace(/ى/g, 'ي');

  // Remove tatweel (kashida): ـ (U+0640)
  result = result.replace(/ـ/g, '');

  // Collapse multiple spaces into one and trim
  result = result.replace(/\s+/g, ' ').trim();

  return result;
}

/**
 * Split Arabic text into words, handling Quran-specific spacing.
 */
export function splitArabicWords(text: string): string[] {
  return text
    .trim()
    .split(/\s+/)
    .filter(w => w.length > 0);
}
