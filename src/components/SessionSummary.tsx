import React from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  Pressable,
  Modal,
} from 'react-native';
import type { RecitationError } from '../services/RecitationTracker';
import { QuranDatabase } from '../services/QuranDatabase';

type Props = {
  visible: boolean;
  errors: RecitationError[];
  ayahsRecited: number;
  onDismiss: () => void;
  onRetryAyah?: (surah: number, ayah: number) => void;
};

export const SessionSummary: React.FC<Props> = ({
  visible,
  errors,
  ayahsRecited,
  onDismiss,
  onRetryAyah,
}) => {
  const skippedWords = errors.filter(e => e.type === 'omission');
  const skippedAyahs = errors.filter(e => e.type === 'ayah_skip');
  const isPerfect = errors.length === 0;

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent
      onRequestClose={onDismiss}
    >
      <View style={styles.overlay}>
        <View style={styles.card}>
          {/* Header icon */}
          <View
            style={[
              styles.iconCircle,
              isPerfect ? styles.iconPerfect : styles.iconErrors,
            ]}
          >
            <Text style={styles.iconText}>{isPerfect ? '✓' : '!'}</Text>
          </View>

          <Text style={styles.title}>
            {isPerfect ? 'Excellent!' : 'Session Complete'}
          </Text>
          {isPerfect && (
            <Text style={styles.subtitle}>
              Perfect recitation — no errors detected
            </Text>
          )}

          {/* Stats row */}
          <View style={styles.statsRow}>
            <StatCard
              label="Ayahs"
              value={ayahsRecited}
              accent="#5bd882"
            />
            <StatCard
              label="Skipped Words"
              value={skippedWords.length}
              accent={skippedWords.length > 0 ? '#f75555' : '#5bd882'}
            />
            <StatCard
              label="Skipped Ayahs"
              value={skippedAyahs.length}
              accent={skippedAyahs.length > 0 ? '#f75555' : '#5bd882'}
            />
          </View>

          {/* Error list */}
          {errors.length > 0 && (
            <ScrollView
              style={styles.errorList}
              showsVerticalScrollIndicator={false}
            >
              <Text style={styles.sectionTitle}>Details</Text>
              {errors.map((error, index) => (
                <ErrorItem
                  key={index}
                  error={error}
                  onRetry={onRetryAyah}
                />
              ))}
            </ScrollView>
          )}

          {/* Close button */}
          <Pressable
            style={({ pressed }) => [
              styles.closeButton,
              pressed && styles.closeButtonPressed,
            ]}
            onPress={onDismiss}
          >
            <Text style={styles.closeButtonText}>Done</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
};

const StatCard: React.FC<{
  label: string;
  value: number;
  accent: string;
}> = ({ label, value, accent }) => (
  <View style={styles.statCard}>
    <Text style={[styles.statValue, { color: accent }]}>{value}</Text>
    <Text style={styles.statLabel}>{label}</Text>
  </View>
);

const ErrorItem: React.FC<{
  error: RecitationError;
  onRetry?: (surah: number, ayah: number) => void;
}> = ({ error, onRetry }) => {
  const surahName = QuranDatabase.getSurahName(error.surah) ?? '';
  const location = `${surahName} ${error.surah}:${error.ayah}`;

  return (
    <View style={styles.errorItem}>
      <View style={styles.errorDot} />
      <View style={styles.errorContent}>
        <Text style={styles.errorLocation}>{location}</Text>
        <Text style={styles.errorDescription}>
          {error.type === 'ayah_skip'
            ? 'Ayah skipped'
            : `Word ${error.wordIndex + 1} skipped`}
        </Text>
        {error.type === 'omission' && (
          <Text style={styles.errorExpected}>{error.expectedWord}</Text>
        )}
      </View>
      {onRetry && (
        <Pressable
          style={styles.retryBtn}
          onPress={() => onRetry(error.surah, error.ayah)}
        >
          <Text style={styles.retryText}>Retry</Text>
        </Pressable>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0,0,0,0.75)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  card: {
    backgroundColor: '#141b22',
    borderRadius: 24,
    padding: 28,
    width: '100%',
    maxHeight: '85%',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.06)',
  },
  iconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  iconPerfect: {
    backgroundColor: 'rgba(91,216,130,0.15)',
  },
  iconErrors: {
    backgroundColor: 'rgba(247,85,85,0.15)',
  },
  iconText: {
    fontSize: 28,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    color: '#5bd882',
    marginBottom: 8,
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    width: '100%',
    marginTop: 20,
    marginBottom: 20,
  },
  statCard: {
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 14,
    paddingVertical: 12,
    paddingHorizontal: 16,
    minWidth: 80,
  },
  statValue: {
    fontSize: 28,
    fontWeight: '800',
  },
  statLabel: {
    fontSize: 11,
    color: '#667788',
    marginTop: 4,
    fontWeight: '500',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#667788',
    marginBottom: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  errorList: {
    width: '100%',
    maxHeight: 250,
    marginBottom: 20,
  },
  errorItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  errorDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#f75555',
    marginRight: 12,
  },
  errorContent: {
    flex: 1,
  },
  errorLocation: {
    fontSize: 14,
    color: '#CCDDEE',
    fontWeight: '500',
  },
  errorDescription: {
    fontSize: 12,
    color: '#667788',
    marginTop: 2,
  },
  errorExpected: {
    fontSize: 18,
    color: '#f75555',
    marginTop: 4,
  },
  retryBtn: {
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: 'rgba(91,216,130,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(91,216,130,0.3)',
  },
  retryText: {
    color: '#5bd882',
    fontSize: 13,
    fontWeight: '600',
  },
  closeButton: {
    width: '100%',
    paddingVertical: 16,
    borderRadius: 14,
    backgroundColor: '#5bd882',
    alignItems: 'center',
  },
  closeButtonPressed: {
    opacity: 0.85,
  },
  closeButtonText: {
    color: '#0d1117',
    fontSize: 17,
    fontWeight: '700',
  },
});
