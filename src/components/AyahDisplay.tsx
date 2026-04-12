/**
 * AyahDisplay — renders a single ayah with per-word color coding
 * using QuranWordView for animated highlighting.
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { QuranWordView } from './QuranWordView';
import type { QuranWord } from '../services/QuranDatabase';
import type { WordStatus } from '../services/RecitationTracker';

type Props = {
  surah: number;
  ayah: number;
  words: QuranWord[];
  wordStatuses: WordStatus[];
  /** Index of the currently active word (-1 if none in this ayah) */
  activeWordIndex?: number;
  /** Whether this ayah is dimmed (not current) */
  dimmed?: boolean;
};

export const AyahDisplay: React.FC<Props> = ({
  surah,
  ayah,
  words,
  wordStatuses,
  activeWordIndex = -1,
  dimmed = false,
}) => {
  return (
    <View style={[styles.container, dimmed && styles.dimmed]}>
      {/* Ayah number badge */}
      <View style={styles.ayahBadge}>
        <Text style={styles.ayahNumber}>{ayah}</Text>
      </View>
      <View style={styles.wordsContainer}>
        {words.map((word, index) => {
          const isActive = index === activeWordIndex;
          const status = isActive
            ? 'active'
            : (wordStatuses[index] ?? 'upcoming');

          return (
            <QuranWordView
              key={`${surah}:${ayah}:${index}`}
              text={word.text}
              status={dimmed ? 'upcoming' : status}
              isLast={index === words.length - 1}
            />
          );
        })}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: 'flex-start',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  dimmed: {
    opacity: 0.35,
  },
  ayahBadge: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 12,
    marginLeft: 8,
  },
  ayahNumber: {
    fontSize: 12,
    color: '#667788',
    fontWeight: '600',
  },
  wordsContainer: {
    flex: 1,
    flexDirection: 'row-reverse', // RTL for Arabic
    flexWrap: 'wrap',
    paddingRight: 4,
  },
});
