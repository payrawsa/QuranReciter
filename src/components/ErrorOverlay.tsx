/**
 * ErrorOverlay — post-session error summary displayed after recitation.
 *
 * Shows:
 * - Total ayahs recited
 * - Number of skipped words and skipped ayahs
 * - List of specific errors with the expected word highlighted in red
 */

import React from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable } from 'react-native';
import type { RecitationError } from '../services/RecitationTracker';
import { QuranDatabase } from '../services/QuranDatabase';

type Props = {
  errors: RecitationError[];
  ayahsRecited: number;
  onDismiss: () => void;
};

export const ErrorOverlay: React.FC<Props> = ({
  errors,
  ayahsRecited,
  onDismiss,
}) => {
  const skippedWords = errors.filter(e => e.type === 'omission');
  const skippedAyahs = errors.filter(e => e.type === 'ayah_skip');

  return (
    <View style={styles.overlay}>
      <View style={styles.card}>
        <Text style={styles.title}>Session Summary</Text>

        <View style={styles.statsRow}>
          <StatBox label="Ayahs Recited" value={ayahsRecited} />
          <StatBox
            label="Skipped Words"
            value={skippedWords.length}
            color={skippedWords.length > 0 ? '#e74c3c' : '#2ecc71'}
          />
          <StatBox
            label="Skipped Ayahs"
            value={skippedAyahs.length}
            color={skippedAyahs.length > 0 ? '#e74c3c' : '#2ecc71'}
          />
        </View>

        {errors.length > 0 && (
          <ScrollView style={styles.errorList}>
            <Text style={styles.sectionTitle}>Errors</Text>
            {errors.map((error, index) => (
              <ErrorRow key={index} error={error} />
            ))}
          </ScrollView>
        )}

        {errors.length === 0 && (
          <Text style={styles.perfectText}>
            Perfect recitation! No errors detected.
          </Text>
        )}

        <Pressable style={styles.dismissButton} onPress={onDismiss}>
          <Text style={styles.dismissText}>Close</Text>
        </Pressable>
      </View>
    </View>
  );
};

const StatBox: React.FC<{
  label: string;
  value: number;
  color?: string;
}> = ({ label, value, color = '#333' }) => (
  <View style={styles.statBox}>
    <Text style={[styles.statValue, { color }]}>{value}</Text>
    <Text style={styles.statLabel}>{label}</Text>
  </View>
);

const ErrorRow: React.FC<{ error: RecitationError }> = ({ error }) => {
  const surahName = QuranDatabase.getSurahName(error.surah) ?? '';
  const location = `${surahName} ${error.surah}:${error.ayah}`;

  if (error.type === 'ayah_skip') {
    return (
      <View style={styles.errorRow}>
        <Text style={styles.errorType}>Ayah Skipped</Text>
        <Text style={styles.errorLocation}>{location}</Text>
      </View>
    );
  }

  return (
    <View style={styles.errorRow}>
      <Text style={styles.errorType}>Word Skipped</Text>
      <Text style={styles.errorLocation}>
        {location} word {error.wordIndex + 1}
      </Text>
      <Text style={styles.errorWord}>{error.expectedWord}</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0,0,0,0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  card: {
    backgroundColor: '#141b22',
    borderRadius: 20,
    padding: 24,
    width: '100%',
    maxHeight: '80%',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  title: {
    fontSize: 22,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 16,
    color: '#FFFFFF',
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: 20,
  },
  statBox: {
    alignItems: 'center',
  },
  statValue: {
    fontSize: 28,
    fontWeight: 'bold',
  },
  statLabel: {
    fontSize: 12,
    color: '#667788',
    marginTop: 4,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#CCDDEE',
    marginBottom: 8,
  },
  errorList: {
    maxHeight: 300,
    marginBottom: 16,
  },
  errorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.06)',
    flexWrap: 'wrap',
    gap: 8,
  },
  errorType: {
    fontSize: 13,
    fontWeight: '600',
    color: '#f75555',
  },
  errorLocation: {
    fontSize: 13,
    color: '#667788',
  },
  errorWord: {
    fontSize: 18,
    color: '#f75555',
    fontWeight: 'bold',
  },
  perfectText: {
    fontSize: 16,
    color: '#5bd882',
    textAlign: 'center',
    marginVertical: 20,
    fontWeight: '600',
  },
  dismissButton: {
    backgroundColor: '#5bd882',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
  },
  dismissText: {
    color: '#0d1117',
    fontSize: 16,
    fontWeight: '700',
  },
});
