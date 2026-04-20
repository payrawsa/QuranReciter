/**
 * useWhisper — React hook that wires together ModelManager + WhisperService
 * to give components a simple interface for real-time Arabic speech-to-text.
 */
import { useState, useRef, useCallback, useEffect } from 'react';
import { ModelManager, DEFAULT_MODEL, type ModelSize, type DownloadProgress } from '../services/ModelManager';
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

  const modelManagerRef = useRef(new ModelManager());
  const whisperServiceRef = useRef(new WhisperService());

  // Auto-download and load the default model on mount
  useEffect(() => {
    loadModel(DEFAULT_MODEL);
    return () => {
      whisperServiceRef.current.release();
    };
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
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load model');
      setStatus('error');
    }
  }, []);

  /**
   * Start real-time transcription.
   * @param targetDurationSec — speech duration per inference (5 for seeking, 1 for tracking)
   */
  const startRecording = useCallback(async (targetDurationSec = 5) => {
    try {
      setError(null);
      setTranscription(null);

      const hasPermission = await requestMicrophonePermission();
      if (!hasPermission) {
        setError('Microphone permission denied');
        return;
      }

      await whisperServiceRef.current.startRealtimeTranscription(targetDurationSec);
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
   * Change the target speech duration without restarting recording.
   */
  const setTargetDuration = useCallback((seconds: number) => {
    whisperServiceRef.current.setTargetDuration(seconds);
  }, []);

  return {
    // State
    status,
    error,
    downloadProgress,
    transcription,
    currentModel,
    // Actions
    startRecording,
    stopRecording,
    setTargetDuration,
  };
}

/** Return type of useWhisper, for passing as props between screens. */
export type WhisperState = ReturnType<typeof useWhisper>;
