/**
 * Script to download the full Quran text from alquran.cloud API
 * and generate a processed JSON file for the app.
 *
 * Usage: node scripts/generate-quran-data.js
 *
 * Outputs: src/data/quran.json
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

// Tashkeel regex — matches the one in src/utils/arabic.ts
const TASHKEEL_REGEX =
  /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06DC\u06DF-\u06E4\u06E7-\u06E8\u06EA-\u06ED]/g;

function stripTashkeel(text) {
  return text.replace(TASHKEEL_REGEX, '');
}

function normalizeArabic(text) {
  let result = stripTashkeel(text);
  result = result.replace(/[أإآٱ]/g, 'ا');
  result = result.replace(/ة/g, 'ه');
  result = result.replace(/ى/g, 'ي');
  result = result.replace(/ـ/g, '');
  result = result.replace(/\s+/g, ' ').trim();
  return result;
}

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        // Follow redirect
        httpsGet(res.headers.location).then(resolve).catch(reject);
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        return;
      }
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => resolve(data));
      res.on('error', reject);
    }).on('error', reject);
  });
}

// Surah metadata (names)
const SURAH_NAMES = [
  'الفاتحة', 'البقرة', 'آل عمران', 'النساء', 'المائدة', 'الأنعام', 'الأعراف',
  'الأنفال', 'التوبة', 'يونس', 'هود', 'يوسف', 'الرعد', 'إبراهيم', 'الحجر',
  'النحل', 'الإسراء', 'الكهف', 'مريم', 'طه', 'الأنبياء', 'الحج', 'المؤمنون',
  'النور', 'الفرقان', 'الشعراء', 'النمل', 'القصص', 'العنكبوت', 'الروم',
  'لقمان', 'السجدة', 'الأحزاب', 'سبأ', 'فاطر', 'يس', 'الصافات', 'ص',
  'الزمر', 'غافر', 'فصلت', 'الشورى', 'الزخرف', 'الدخان', 'الجاثية', 'الأحقاف',
  'محمد', 'الفتح', 'الحجرات', 'ق', 'الذاريات', 'الطور', 'النجم', 'القمر',
  'الرحمن', 'الواقعة', 'الحديد', 'المجادلة', 'الحشر', 'الممتحنة', 'الصف',
  'الجمعة', 'المنافقون', 'التغابن', 'الطلاق', 'التحريم', 'الملك', 'القلم',
  'الحاقة', 'المعارج', 'نوح', 'الجن', 'المزمل', 'المدثر', 'القيامة',
  'الإنسان', 'المرسلات', 'النبأ', 'النازعات', 'عبس', 'التكوير', 'الانفطار',
  'المطففين', 'الانشقاق', 'البروج', 'الطارق', 'الأعلى', 'الغاشية', 'الفجر',
  'البلد', 'الشمس', 'الليل', 'الضحى', 'الشرح', 'التين', 'العلق', 'القدر',
  'البينة', 'الزلزلة', 'العاديات', 'القارعة', 'التكاثر', 'العصر', 'الهمزة',
  'الفيل', 'قريش', 'الماعون', 'الكوثر', 'الكافرون', 'النصر', 'المسد',
  'الإخلاص', 'الفلق', 'الناس'
];

async function main() {
  console.log('Downloading Quran text from alquran.cloud API...');
  console.log('Edition: quran-uthmani (Uthmani script with tashkeel)');

  const raw = await httpsGet('https://api.alquran.cloud/v1/quran/quran-uthmani');
  const apiResponse = JSON.parse(raw);

  if (apiResponse.code !== 200 || !apiResponse.data || !apiResponse.data.surahs) {
    throw new Error('Unexpected API response structure');
  }

  const surahs = apiResponse.data.surahs;
  console.log(`Received ${surahs.length} surahs`);

  const quranData = [];

  for (const surah of surahs) {
    const surahNumber = surah.number;
    const surahName = SURAH_NAMES[surahNumber - 1] || surah.name;

    for (const ayah of surah.ayahs) {
      const ayahNumber = ayah.numberInSurah;
      const text = ayah.text;

      // Split into words
      const rawWords = text.trim().split(/\s+/).filter(w => w.length > 0);
      const words = rawWords.map((word, index) => ({
        index,
        text: word,
        textClean: normalizeArabic(word),
      }));

      quranData.push({
        surah: surahNumber,
        surahName,
        ayah: ayahNumber,
        text,
        words,
      });
    }
  }

  console.log(`Processed ${quranData.length} ayahs total`);

  // Count total words
  const totalWords = quranData.reduce((sum, a) => sum + a.words.length, 0);
  console.log(`Total words: ${totalWords}`);

  // Write output
  const outDir = path.join(__dirname, '..', 'src', 'data');
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  const outPath = path.join(outDir, 'quran.json');
  fs.writeFileSync(outPath, JSON.stringify(quranData, null, 0), 'utf8');

  const sizeMB = (fs.statSync(outPath).size / 1024 / 1024).toFixed(2);
  console.log(`Written to ${outPath} (${sizeMB} MB)`);
  console.log('Done!');
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
