/**
 * AyahDisplay — renders a single ayah with per-word color coding.
 *
 * Word colors:
 * - Gray (#999): upcoming words (not yet reached)
 * - Green (#2ecc71): current active word
 * - Dark text (default): correctly recited words
 * - Red (#e74c3c): skipped/error words
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import type { QuranWord } from '../services/QuranDatabase';
import type { WordStatus } from '../services/RecitationTracker';

type Props = {
  surah: number;
  ayah: number;
  words: QuranWord[];
  wordStatuses: WordStatus[];
  /** Index of the currently active word (-1 if none in this ayah) */
  activeWordIndex?: number;
};

const WORD_COLORS: Record<WordStatus, string> = {
  upcoming: '#999999',
  active: '#2ecc71',
  correct: '#333333',
  skipped: '#e74c3c',
};

export const AyahDisplay: React.FC<Props> = ({
  surah,
  ayah,
  words,
  wordStatuses,
  activeWordIndex = -1,
}) => {
  return (
    <View style={styles.container}>
      <Text style={styles.ayahNumber}>{ayah}</Text>
      <View style={styles.wordsContainer}>
        {words.map((word, index) => {
          const isActive = index === activeWordIndex;
          const status = isActive ? 'active' : (wordStatuses[index] ?? 'upcoming');
          const color = WORD_COLORS[status];

          return (
            <Text
              key={`${surah}:${ayah}:${index}`}
              style={[
                styles.word,
                { color },
                isActive && styles.activeWord,
                status === 'skipped' && styles.skippedWord,
              ]}
            >
              {word.text}
              {index < words.length - 1 ? ' ' : ''}
            </Text>
          );
        })}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    paddingVertical: 8,
    paddingHorizontal: 16,
    alignItems: 'flex-start',
  },
  ayahNumber: {
    fontSize: 14,
    color: '#888',
    marginRight: 8,
    marginTop: 4,
    minWidth: 24,
    textAlign: 'center',
  },
  wordsContainer: {
    flex: 1,
    flexDirection: 'row-reverse', // RTL for Arabic
    flexWrap: 'wrap',
  },
  word: {
    fontSize: 24,
    lineHeight: 42,
    fontFamily: undefined, // uses system Arabic font
  },
  activeWord: {
    fontWeight: 'bold',
    textDecorationLine: 'underline',
  },
  skippedWord: {
    textDecorationLine: 'line-through',
  },
});
