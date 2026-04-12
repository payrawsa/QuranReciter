/**
 * RecorderScreen — test UI for voice-to-text functionality.
 *
 * Lets the user:
 * 1. Pick and download a Whisper model
 * 2. Tap to start/stop real-time transcription
 * 3. See the Arabic transcription output live
 */
import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  Alert,
  I18nManager,
} from 'react-native';
import { useWhisper, type WhisperStatus } from '../hooks/useWhisper';
import type { ModelSize } from '../services/ModelManager';

// Force RTL for Arabic text display
I18nManager.allowRTL(true);

const STATUS_LABELS: Record<WhisperStatus, string> = {
  idle: 'No model loaded',
  downloading: 'Downloading model…',
  loading: 'Loading model…',
  ready: 'Ready — tap Record',
  recording: '● Recording…',
  error: 'Error',
};

export default function RecorderScreen() {
  const {
    status,
    error,
    downloadProgress,
    transcription,
    currentModel,
    availableModels,
    loadModel,
    startRecording,
    stopRecording,
    deleteModel,
    cancelDownload,
  } = useWhisper();

  const isLoading = status === 'downloading' || status === 'loading';

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>Quran Reciter</Text>
        <Text style={styles.statusText}>{STATUS_LABELS[status]}</Text>
        {error && <Text style={styles.errorText}>{error}</Text>}
      </View>

      {/* Download Progress */}
      {status === 'downloading' && downloadProgress && (
        <View style={styles.progressSection}>
          <View style={styles.progressBarBg}>
            <View
              style={[
                styles.progressBarFill,
                { width: `${downloadProgress.percent}%` },
              ]}
            />
          </View>
          <Text style={styles.progressText}>
            {downloadProgress.percent}% —{' '}
            {Math.round(downloadProgress.bytesWritten / 1024 / 1024)} /{' '}
            {Math.round(downloadProgress.contentLength / 1024 / 1024)} MB
          </Text>
          <TouchableOpacity style={styles.cancelBtn} onPress={cancelDownload}>
            <Text style={styles.cancelBtnText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Model Selection */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Whisper Models</Text>
        {availableModels.map((model) => (
          <View key={model.size} style={styles.modelRow}>
            <View style={styles.modelInfo}>
              <Text style={styles.modelLabel}>
                {model.label}
                {currentModel === model.size ? ' ✓' : ''}
              </Text>
              <Text style={styles.modelDesc}>{model.description}</Text>
            </View>
            <View style={styles.modelActions}>
              {model.downloaded ? (
                <>
                  <TouchableOpacity
                    style={[
                      styles.btn,
                      currentModel === model.size && styles.btnActive,
                    ]}
                    disabled={isLoading || currentModel === model.size}
                    onPress={() => loadModel(model.size)}
                  >
                    <Text style={styles.btnText}>
                      {currentModel === model.size ? 'Active' : 'Use'}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.deleteBtn}
                    disabled={isLoading}
                    onPress={() =>
                      Alert.alert(
                        'Delete Model',
                        `Delete ${model.label}? You can re-download it later.`,
                        [
                          { text: 'Cancel', style: 'cancel' },
                          {
                            text: 'Delete',
                            style: 'destructive',
                            onPress: () => deleteModel(model.size as ModelSize),
                          },
                        ],
                      )
                    }
                  >
                    <Text style={styles.deleteBtnText}>✕</Text>
                  </TouchableOpacity>
                </>
              ) : (
                <TouchableOpacity
                  style={styles.btn}
                  disabled={isLoading}
                  onPress={() => loadModel(model.size as ModelSize)}
                >
                  {isLoading ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Text style={styles.btnText}>Download</Text>
                  )}
                </TouchableOpacity>
              )}
            </View>
          </View>
        ))}
      </View>

      {/* Record Button */}
      <View style={styles.recordSection}>
        <TouchableOpacity
          style={[
            styles.recordBtn,
            status === 'recording' && styles.recordBtnActive,
          ]}
          disabled={status !== 'ready' && status !== 'recording'}
          onPress={status === 'recording' ? stopRecording : startRecording}
        >
          <Text style={styles.recordBtnText}>
            {status === 'recording' ? '■ Stop' : '● Record'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Transcription Output */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Transcription</Text>
        <ScrollView style={styles.transcriptBox}>
          {transcription ? (
            <Text style={styles.arabicText}>
              {transcription.text || '(listening…)'}
            </Text>
          ) : (
            <Text style={styles.placeholderText}>
              Transcribed Arabic text will appear here…
            </Text>
          )}
        </ScrollView>

        {/* Segments with timestamps (debug view) */}
        {transcription?.segments && transcription.segments.length > 0 && (
          <ScrollView style={styles.segmentsBox}>
            <Text style={styles.sectionTitle}>Segments</Text>
            {transcription.segments.map((seg, idx) => (
              <Text key={idx} style={styles.segmentText}>
                [{(seg.t0 / 1000).toFixed(1)}s – {(seg.t1 / 1000).toFixed(1)}s]{' '}
                {seg.text}
              </Text>
            ))}
          </ScrollView>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0a',
    paddingTop: 60,
  },
  header: {
    paddingHorizontal: 20,
    marginBottom: 16,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#fff',
  },
  statusText: {
    fontSize: 14,
    color: '#888',
    marginTop: 4,
  },
  errorText: {
    fontSize: 13,
    color: '#ff4444',
    marginTop: 4,
  },
  progressSection: {
    paddingHorizontal: 20,
    marginBottom: 16,
  },
  progressBarBg: {
    height: 8,
    backgroundColor: '#333',
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: '#4CAF50',
    borderRadius: 4,
  },
  progressText: {
    fontSize: 12,
    color: '#aaa',
    marginTop: 4,
  },
  cancelBtn: {
    marginTop: 8,
    alignSelf: 'flex-start',
  },
  cancelBtnText: {
    color: '#ff4444',
    fontSize: 14,
  },
  section: {
    paddingHorizontal: 20,
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#ccc',
    marginBottom: 8,
  },
  modelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#1a1a1a',
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
  },
  modelInfo: {
    flex: 1,
    marginRight: 12,
  },
  modelLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
  },
  modelDesc: {
    fontSize: 12,
    color: '#888',
    marginTop: 2,
  },
  modelActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  btn: {
    backgroundColor: '#2196F3',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 6,
  },
  btnActive: {
    backgroundColor: '#4CAF50',
  },
  btnText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
  deleteBtn: {
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  deleteBtnText: {
    color: '#ff4444',
    fontSize: 16,
  },
  recordSection: {
    alignItems: 'center',
    marginVertical: 16,
  },
  recordBtn: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: '#333',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
    borderColor: '#555',
  },
  recordBtnActive: {
    backgroundColor: '#c62828',
    borderColor: '#ff4444',
  },
  recordBtnText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
  },
  transcriptBox: {
    backgroundColor: '#1a1a1a',
    borderRadius: 10,
    padding: 16,
    minHeight: 80,
    maxHeight: 160,
  },
  arabicText: {
    fontSize: 24,
    color: '#fff',
    textAlign: 'right',
    writingDirection: 'rtl',
    fontFamily: 'System',
    lineHeight: 40,
  },
  placeholderText: {
    fontSize: 14,
    color: '#555',
    textAlign: 'center',
  },
  segmentsBox: {
    marginTop: 12,
    backgroundColor: '#111',
    borderRadius: 8,
    padding: 12,
    maxHeight: 150,
  },
  segmentText: {
    fontSize: 13,
    color: '#aaa',
    marginBottom: 4,
    writingDirection: 'rtl',
  },
});
