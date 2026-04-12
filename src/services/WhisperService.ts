/**
 * WhisperService — manages Whisper model lifecycle and provides
 * real-time transcription using the RealtimeTranscriber from whisper.rn.
 *
 * Key features:
 * - Initializes a WhisperContext from a downloaded .bin model file
 * - Provides real-time streaming transcription with word-level timestamps
 * - Configurable for Arabic language with VAD support
 */
import {
  initWhisper,
  type WhisperContext,
  type TranscribeResult,
} from 'whisper.rn/index';
import { RealtimeTranscriber } from 'whisper.rn/realtime-transcription/RealtimeTranscriber';
import { AudioPcmStreamAdapter } from 'whisper.rn/realtime-transcription/adapters/AudioPcmStreamAdapter';
import type {
  RealtimeTranscribeEvent,
  RealtimeOptions,
} from 'whisper.rn/realtime-transcription/types';

export type TranscriptionSegment = {
  text: string;
  t0: number; // start time ms
  t1: number; // end time ms
};

export type TranscriptionUpdate = {
  text: string;
  segments: TranscriptionSegment[];
  isCapturing: boolean;
};

export type WhisperServiceCallbacks = {
  onTranscription?: (update: TranscriptionUpdate) => void;
  onError?: (error: string) => void;
  onModelLoaded?: () => void;
};

export class WhisperService {
  private context: WhisperContext | null = null;
  private transcriber: RealtimeTranscriber | null = null;
  private callbacks: WhisperServiceCallbacks = {};
  private modelPath: string = '';

  /**
   * Initialize the Whisper context with a model file path.
   * Call this after the model has been downloaded.
   */
  async initModel(modelFilePath: string): Promise<void> {
    if (this.context) {
      await this.context.release();
    }

    this.modelPath = modelFilePath;

    this.context = await initWhisper({
      filePath: modelFilePath,
      useGpu: true,
      useFlashAttn: true,
    });

    this.callbacks.onModelLoaded?.();
  }

  /**
   * Check if the model is loaded and ready.
   */
  isReady(): boolean {
    return this.context !== null;
  }

  /**
   * Set callbacks for transcription events.
   */
  setCallbacks(callbacks: WhisperServiceCallbacks): void {
    this.callbacks = callbacks;
  }

  /**
   * Start real-time transcription from the microphone.
   * Uses RealtimeTranscriber with VAD and Arabic language settings.
   */
  async startRealtimeTranscription(): Promise<void> {
    if (!this.context) {
      throw new Error('Whisper model not initialized. Call initModel() first.');
    }

    if (this.transcriber) {
      await this.stopRealtimeTranscription();
    }

    const audioStream = new AudioPcmStreamAdapter();

    const options: RealtimeOptions = {
      audioSliceSec: 25,
      audioMinSec: 1,
      maxSlicesInMemory: 3,
      transcribeOptions: {
        language: 'ar',
        maxLen: 1,        // segment by word for word-level tracking
        tokenTimestamps: true,
        wordThold: 0.6,
      },
      vadPreset: 'default',
      autoSliceOnSpeechEnd: true,
      promptPreviousSlices: true,
    };

    this.transcriber = new RealtimeTranscriber(
      {
        whisperContext: this.context,
        audioStream,
      },
      options,
      {
        onTranscribe: (event: RealtimeTranscribeEvent) => {
          const update: TranscriptionUpdate = {
            text: event.data?.result ?? '',
            segments: (event.data?.segments ?? []).map((seg) => ({
              text: seg.text,
              t0: seg.t0,
              t1: seg.t1,
            })),
            isCapturing: event.isCapturing,
          };
          this.callbacks.onTranscription?.(update);
        },
        onError: (error: string) => {
          this.callbacks.onError?.(error);
        },
      },
    );

    await this.transcriber.start();
  }

  /**
   * Stop the current real-time transcription session.
   */
  async stopRealtimeTranscription(): Promise<void> {
    if (this.transcriber) {
      await this.transcriber.stop();
      this.transcriber = null;
    }
  }

  /**
   * Transcribe a single audio file (for testing / offline use).
   */
  async transcribeFile(
    filePath: string,
  ): Promise<TranscribeResult | null> {
    if (!this.context) {
      throw new Error('Whisper model not initialized.');
    }

    const { promise } = this.context.transcribe(filePath, {
      language: 'ar',
      tokenTimestamps: true,
      wordThold: 0.6,
    });

    return promise;
  }

  /**
   * Release all resources.
   */
  async release(): Promise<void> {
    await this.stopRealtimeTranscription();
    if (this.context) {
      await this.context.release();
      this.context = null;
    }
  }
}
