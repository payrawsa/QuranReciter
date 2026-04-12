/**
 * useWhisper — React hook that wires together ModelManager + WhisperService
 * to give components a simple interface for real-time Arabic speech-to-text.
 */
import { useState, useRef, useCallback, useEffect } from 'react';
import { ModelManager, type ModelSize, type DownloadProgress } from '../services/ModelManager';
import { WhisperService, type TranscriptionUpdate } from '../services/WhisperService';
import { requestMicrophonePermission } from '../utils/permissions';

export type WhisperStatus =
  | 'idle'           // no model loaded
  | 'downloading'    // model downloading
  | 'loading'        // model initializing
  | 'ready'          // model loaded, waiting to record
  | 'recording'      // actively transcribing
  | 'error';

export function useWhisper() {
  const [status, setStatus] = useState<WhisperStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgress | null>(null);
  const [transcription, setTranscription] = useState<TranscriptionUpdate | null>(null);
  const [currentModel, setCurrentModel] = useState<ModelSize | null>(null);
  const [availableModels, setAvailableModels] = useState<
    Array<{ size: ModelSize; label: string; downloaded: boolean; diskSizeMB: number; description: string }>
  >([]);

  const modelManagerRef = useRef(new ModelManager());
  const whisperServiceRef = useRef(new WhisperService());

  // Load available models on mount
  useEffect(() => {
    refreshModels();
    return () => {
      whisperServiceRef.current.release();
    };
  }, []);

  const refreshModels = useCallback(async () => {
    const models = await modelManagerRef.current.getAvailableModels();
    setAvailableModels(models);
  }, []);

  /**
   * Download and initialize a Whisper model.
   */
  const loadModel = useCallback(async (size: ModelSize) => {
    try {
      setError(null);

      // Step 1: Download if needed
      setStatus('downloading');
      const modelPath = await modelManagerRef.current.downloadModel(size, {
        onProgress: (progress) => setDownloadProgress(progress),
        onComplete: () => setDownloadProgress(null),
        onError: (err) => {
          setError(err);
          setStatus('error');
        },
      });

      // Step 2: Initialize Whisper context
      setStatus('loading');
      whisperServiceRef.current.setCallbacks({
        onTranscription: (update) => setTranscription(update),
        onError: (err) => setError(err),
        onModelLoaded: () => {
          setStatus('ready');
          setCurrentModel(size);
        },
      });

      await whisperServiceRef.current.initModel(modelPath);
      await refreshModels();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load model');
      setStatus('error');
    }
  }, [refreshModels]);

  /**
   * Start real-time transcription.
   */
  const startRecording = useCallback(async () => {
    try {
      setError(null);
      setTranscription(null);

      const hasPermission = await requestMicrophonePermission();
      if (!hasPermission) {
        setError('Microphone permission denied');
        return;
      }

      await whisperServiceRef.current.startRealtimeTranscription();
      setStatus('recording');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start recording');
      setStatus('error');
    }
  }, []);

  /**
   * Stop real-time transcription.
   */
  const stopRecording = useCallback(async () => {
    try {
      await whisperServiceRef.current.stopRealtimeTranscription();
      setStatus('ready');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to stop recording');
    }
  }, []);

  /**
   * Delete a downloaded model.
   */
  const deleteModel = useCallback(async (size: ModelSize) => {
    await modelManagerRef.current.deleteModel(size);
    if (currentModel === size) {
      await whisperServiceRef.current.release();
      setCurrentModel(null);
      setStatus('idle');
    }
    await refreshModels();
  }, [currentModel, refreshModels]);

  /**
   * Cancel an active download.
   */
  const cancelDownload = useCallback(() => {
    modelManagerRef.current.cancelDownload();
    setDownloadProgress(null);
    setStatus('idle');
  }, []);

  return {
    // State
    status,
    error,
    downloadProgress,
    transcription,
    currentModel,
    availableModels,
    // Actions
    loadModel,
    startRecording,
    stopRecording,
    deleteModel,
    cancelDownload,
  };
}
