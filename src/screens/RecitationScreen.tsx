/**
 * RecitationScreen — main Quran recitation practice screen.
 *
 * Ties together Whisper transcription, QuranSearch position detection,
 * RecitationTracker word-by-word tracking, and the AyahDisplay UI.
 */
import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  Animated,
  I18nManager,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AyahDisplay } from '../components/AyahDisplay';
import { SurahSelector } from '../components/SurahSelector';
import { SessionSummary } from '../components/SessionSummary';
import { useWhisper } from '../hooks/useWhisper';
import {
  QuranDatabase,
  QuranSearch,
  RecitationTracker,
  type AyahData,
  type RecitationError,
  type WordStatus,
} from '../services';
import { splitArabicWords } from '../utils/arabic';

I18nManager.allowRTL(true);

type RecitationPhase =
  | 'idle'       // Waiting for user to pick surah and start
  | 'seeking'    // Recording, looking for position
  | 'tracking'   // Position locked, tracking word-by-word
  | 'stopped';   // Session ended, showing summary

export default function RecitationScreen({
  onBack,
}: {
  onBack: () => void;
}) {
  const insets = useSafeAreaInsets();

  // ── Whisper ──
  const {
    status: whisperStatus,
    transcription,
    startRecording,
    stopRecording,
  } = useWhisper();

  // ── Recitation state ──
  const [phase, setPhase] = useState<RecitationPhase>('idle');
  const [surah, setSurah] = useState(1);
  const [ayah, setAyah] = useState(1);
  const [currentWordIndex, setCurrentWordIndex] = useState(0);
  const [errors, setErrors] = useState<RecitationError[]>([]);
  const [ayahsRecited, setAyahsRecited] = useState(0);
  const [showSurahSelector, setShowSurahSelector] = useState(false);
  const [showSummary, setShowSummary] = useState(false);
  const [wordStatuses, setWordStatuses] = useState<
    Map<string, WordStatus>
  >(new Map());

  // ── Refs ──
  const trackerRef = useRef(new RecitationTracker());
  const transcriptWordsRef = useRef<string[]>([]);
  const seekingWordsRef = useRef<string[]>([]);
  const pulseAnim = useRef(new Animated.Value(1)).current;

  // ── Build search index on mount ──
  useEffect(() => {
    if (!QuranSearch.isIndexReady()) {
      QuranSearch.buildIndex();
    }
  }, []);

  // ── Get ayah data for display ──
  const currentAyah = QuranDatabase.getAyah(surah, ayah);
  const nextAyahData = getNextAyah(surah, ayah);
  const prevAyahData = getPrevAyah(surah, ayah);
  const surahName = QuranDatabase.getSurahName(surah) ?? `Surah ${surah}`;

  // ── Pulse animation for recording indicator ──
  useEffect(() => {
    if (phase === 'seeking' || phase === 'tracking') {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 0.3,
            duration: 800,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 800,
            useNativeDriver: true,
          }),
        ]),
      ).start();
    } else {
      pulseAnim.stopAnimation();
      pulseAnim.setValue(1);
    }
  }, [phase, pulseAnim]);

  // ── Process incoming transcription ──
  useEffect(() => {
    if (!transcription?.text) return;

    const words = splitArabicWords(transcription.text);
    if (words.length === 0) return;

    if (phase === 'seeking') {
      seekingWordsRef.current = words;
      // Try to find position once we have enough words
      if (words.length >= 3) {
        const result = QuranSearch.findPosition(words);
        if (result && result.confidence >= 0.3) {
          // Found position — start tracking
          setSurah(result.position.surah);
          setAyah(result.position.ayah);
          setCurrentWordIndex(result.position.wordIndex);
          beginTracking(
            result.position.surah,
            result.position.ayah,
            result.position.wordIndex,
          );
          setPhase('tracking');
        }
      }
    } else if (phase === 'tracking') {
      transcriptWordsRef.current = words;
      trackerRef.current.processWords(words);

      // Update UI state from tracker
      const pos = trackerRef.current.getCurrentPosition();
      setSurah(pos.surah);
      setAyah(pos.ayah);
      setCurrentWordIndex(pos.wordIndex);
      setErrors(trackerRef.current.getErrors());
      refreshWordStatuses(pos.surah, pos.ayah);
    }
  }, [transcription, phase]);

  // ── Tracking setup ──
  const beginTracking = useCallback(
    (s: number, a: number, w: number) => {
      const tracker = trackerRef.current;
      tracker.startTracking(s, a, w, {
        onPositionChange: event => {
          setSurah(event.current.surah);
          setAyah(event.current.ayah);
          setCurrentWordIndex(event.current.wordIndex);
          refreshWordStatuses(event.current.surah, event.current.ayah);
        },
        onAyahComplete: () => {
          setAyahsRecited(prev => prev + 1);
        },
        onError: () => {
          setErrors(tracker.getErrors());
        },
      });
    },
    [],
  );

  const refreshWordStatuses = (s: number, a: number) => {
    const tracker = trackerRef.current;
    const newMap = new Map<string, WordStatus>();

    // Current ayah
    const statuses = tracker.getAyahWordStatuses(s, a);
    statuses.forEach((st, i) => newMap.set(`${s}:${a}:${i}`, st));

    // Previous ayah if exists
    const prev = getPrevAyah(s, a);
    if (prev) {
      const prevStatuses = tracker.getAyahWordStatuses(prev.surah, prev.ayah);
      prevStatuses.forEach((st, i) =>
        newMap.set(`${prev.surah}:${prev.ayah}:${i}`, st),
      );
    }

    // Next ayah
    const next = getNextAyah(s, a);
    if (next) {
      const nextStatuses = tracker.getAyahWordStatuses(next.surah, next.ayah);
      nextStatuses.forEach((st, i) =>
        newMap.set(`${next.surah}:${next.ayah}:${i}`, st),
      );
    }

    setWordStatuses(newMap);
  };

  // ── Actions ──
  const handleRecord = async () => {
    if (phase === 'idle' || phase === 'stopped') {
      // Reset state
      setErrors([]);
      setAyahsRecited(0);
      setWordStatuses(new Map());
      transcriptWordsRef.current = [];
      seekingWordsRef.current = [];
      trackerRef.current.stop();

      await startRecording();
      setPhase('seeking');
    } else {
      // Stop recording
      await stopRecording();
      trackerRef.current.stop();
      setErrors(trackerRef.current.getErrors());
      setPhase('stopped');
      setShowSummary(true);
    }
  };

  const handleSurahSelect = (s: number, a: number) => {
    setSurah(s);
    setAyah(a);
    setCurrentWordIndex(0);
    setShowSurahSelector(false);
    setWordStatuses(new Map());
  };

  const handleRetryAyah = (s: number, a: number) => {
    setSurah(s);
    setAyah(a);
    setCurrentWordIndex(0);
    setShowSummary(false);
    setPhase('idle');
  };

  const getStatusLabel = (): string => {
    switch (phase) {
      case 'idle':
        return whisperStatus === 'ready'
          ? 'Tap record to begin'
          : 'Load a model first';
      case 'seeking':
        return 'Listening… start reciting';
      case 'tracking':
        return `Word ${currentWordIndex + 1}/${currentAyah?.words.length ?? '?'}`;
      case 'stopped':
        return 'Session ended';
    }
  };

  const getWordStatusesForAyah = (
    s: number,
    a: number,
  ): WordStatus[] => {
    const ayahData = QuranDatabase.getAyah(s, a);
    if (!ayahData) return [];
    return ayahData.words.map(
      (_, i) => wordStatuses.get(`${s}:${a}:${i}`) ?? 'upcoming',
    );
  };

  const isRecording = phase === 'seeking' || phase === 'tracking';
  const canRecord = whisperStatus === 'ready' || whisperStatus === 'recording';

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {/* ── Header ── */}
      <View style={styles.header}>
        <Pressable onPress={onBack} style={styles.headerButton}>
          <Text style={styles.headerButtonText}>‹</Text>
        </Pressable>
        <Pressable
          onPress={() => setShowSurahSelector(true)}
          style={styles.headerCenter}
        >
          <Text style={styles.surahTitle}>{surahName}</Text>
          <Text style={styles.ayahRange}>Ayah {ayah} ▾</Text>
        </Pressable>
        <View style={styles.headerButton} />
      </View>

      {/* ── Quran text display ── */}
      <ScrollView
        style={styles.quranArea}
        contentContainerStyle={styles.quranContent}
        showsVerticalScrollIndicator={false}
      >
        {/* Previous ayah (dimmed) */}
        {prevAyahData && (
          <AyahDisplay
            surah={prevAyahData.surah}
            ayah={prevAyahData.ayah}
            words={prevAyahData.words}
            wordStatuses={getWordStatusesForAyah(
              prevAyahData.surah,
              prevAyahData.ayah,
            )}
            dimmed
          />
        )}

        {/* Current ayah (highlighted) */}
        {currentAyah && (
          <AyahDisplay
            surah={currentAyah.surah}
            ayah={currentAyah.ayah}
            words={currentAyah.words}
            wordStatuses={getWordStatusesForAyah(
              currentAyah.surah,
              currentAyah.ayah,
            )}
            activeWordIndex={
              phase === 'tracking' ? currentWordIndex : -1
            }
          />
        )}

        {/* Next ayah (dimmed) */}
        {nextAyahData && (
          <AyahDisplay
            surah={nextAyahData.surah}
            ayah={nextAyahData.ayah}
            words={nextAyahData.words}
            wordStatuses={getWordStatusesForAyah(
              nextAyahData.surah,
              nextAyahData.ayah,
            )}
            dimmed
          />
        )}
      </ScrollView>

      {/* ── Bottom controls ── */}
      <View style={[styles.controls, { paddingBottom: insets.bottom + 16 }]}>
        {/* Status bar */}
        <View style={styles.statusBar}>
          <View style={styles.statusLeft}>
            {isRecording && (
              <Animated.View
                style={[styles.recordingDot, { opacity: pulseAnim }]}
              />
            )}
            <Text style={styles.statusText}>{getStatusLabel()}</Text>
          </View>
          {phase === 'tracking' && (
            <View style={styles.errorBadge}>
              <Text
                style={[
                  styles.errorBadgeText,
                  errors.length > 0 && styles.errorBadgeActive,
                ]}
              >
                {errors.length} {errors.length === 1 ? 'error' : 'errors'}
              </Text>
            </View>
          )}
        </View>

        {/* Record button */}
        <View style={styles.recordContainer}>
          <Pressable
            style={({ pressed }) => [
              styles.recordButton,
              isRecording && styles.recordButtonActive,
              pressed && styles.recordButtonPressed,
              !canRecord && styles.recordButtonDisabled,
            ]}
            onPress={handleRecord}
            disabled={!canRecord}
          >
            <View
              style={[
                styles.recordInner,
                isRecording && styles.recordInnerActive,
              ]}
            />
          </Pressable>
          <Text style={styles.recordLabel}>
            {isRecording ? 'Stop' : 'Record'}
          </Text>
        </View>
      </View>

      {/* ── Modals ── */}
      <SurahSelector
        visible={showSurahSelector}
        onSelect={handleSurahSelect}
        onClose={() => setShowSurahSelector(false)}
      />
      <SessionSummary
        visible={showSummary}
        errors={errors}
        ayahsRecited={ayahsRecited}
        onDismiss={() => setShowSummary(false)}
        onRetryAyah={handleRetryAyah}
      />
    </View>
  );
}

// ── Helpers ──

function getNextAyah(surah: number, ayah: number): AyahData | undefined {
  const next = QuranDatabase.getAyah(surah, ayah + 1);
  if (next) return next;
  return QuranDatabase.getAyah(surah + 1, 1);
}

function getPrevAyah(surah: number, ayah: number): AyahData | undefined {
  if (ayah > 1) return QuranDatabase.getAyah(surah, ayah - 1);
  if (surah > 1) {
    const prevSurah = QuranDatabase.getSurah(surah - 1);
    return prevSurah.length > 0
      ? prevSurah[prevSurah.length - 1]
      : undefined;
  }
  return undefined;
}

// ── Styles ──

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0d1117',
  },

  // Header
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  headerButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerButtonText: {
    color: '#5bd882',
    fontSize: 28,
    fontWeight: '300',
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
  },
  surahTitle: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '700',
  },
  ayahRange: {
    color: '#667788',
    fontSize: 13,
    marginTop: 1,
  },

  // Quran display area
  quranArea: {
    flex: 1,
  },
  quranContent: {
    paddingVertical: 24,
  },

  // Bottom controls
  controls: {
    backgroundColor: '#0d1117',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(255,255,255,0.06)',
    paddingTop: 12,
  },

  // Status bar
  statusBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    marginBottom: 16,
  },
  statusLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  recordingDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#f75555',
    marginRight: 8,
  },
  statusText: {
    color: '#667788',
    fontSize: 14,
    fontWeight: '500',
  },
  errorBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    backgroundColor: 'rgba(255,255,255,0.04)',
  },
  errorBadgeText: {
    color: '#5bd882',
    fontSize: 12,
    fontWeight: '600',
  },
  errorBadgeActive: {
    color: '#f75555',
  },

  // Record button
  recordContainer: {
    alignItems: 'center',
  },
  recordButton: {
    width: 72,
    height: 72,
    borderRadius: 36,
    borderWidth: 3,
    borderColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  recordButtonActive: {
    borderColor: '#f75555',
  },
  recordButtonPressed: {
    opacity: 0.8,
    transform: [{ scale: 0.95 }],
  },
  recordButtonDisabled: {
    opacity: 0.3,
  },
  recordInner: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#f75555',
  },
  recordInnerActive: {
    borderRadius: 8,
    width: 28,
    height: 28,
  },
  recordLabel: {
    color: '#667788',
    fontSize: 12,
    fontWeight: '500',
    marginTop: 6,
  },
});
