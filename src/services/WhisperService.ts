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

/** Minimum audio duration (seconds) before we actually run inference. */
const MIN_AUDIO_SEC = 3;
/** Bytes per second for 16-bit mono 16 kHz PCM. */
const BYTES_PER_SEC = 16000 * 2;
/** Minimum byte count before we run inference. */
const MIN_AUDIO_BYTES = MIN_AUDIO_SEC * BYTES_PER_SEC;

/**
 * Base64-encode raw int16 PCM audio for the native bridge `transcribeData` method.
 *
 * The native bridge (RNWhisperAudioUtils) expects base64-encoded **int16 PCM**
 * and converts to float32 internally. We must NOT convert to float32 in JS —
 * doing so would cause the native side to misinterpret float32 bytes as int16,
 * producing garbage audio.
 */
function int16PcmToBase64(arrayBuffer: ArrayBuffer): string {
  const bytes = new Uint8Array(arrayBuffer);
  const CHUNK = 8192;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const slice = bytes.subarray(i, Math.min(i + CHUNK, bytes.length));
    binary += String.fromCharCode.apply(null, Array.from(slice));
  }
  return global.btoa(binary);
}

/**
 * Return a no-op transcription result when audio is too short to bother with.
 * Shape matches TranscribeResult so RealtimeTranscriber's state machine
 * continues normally.
 */
function emptyTranscribeResult(): {
  stop: () => Promise<void>;
  promise: Promise<TranscribeResult>;
} {
  return {
    stop: async () => {},
    promise: Promise.resolve({
      result: '',
      language: 'ar',
      segments: [],
      isAborted: false,
    }),
  };
}

/**
 * Patch a WhisperContext so that transcribeData():
 *
 * 1. Converts ArrayBuffer (16-bit PCM) to base64-encoded int16 PCM and uses
 *    the native bridge path instead of JSI (JSI requires RCTBridge which isn't
 *    always available in bridgeless / new-arch mode).
 *
 * 2. Enforces a minimum audio duration. The RealtimeTranscriber's non-VAD code
 *    path ignores audioMinSec and will queue tiny (<1 s) clips that produce
 *    hallucinated text. We short-circuit those with an empty result.
 */
function patchContextForBridgeFallback(ctx: WhisperContext): WhisperContext {
  const original = ctx.transcribeData.bind(ctx);

  ctx.transcribeData = (data: string | ArrayBuffer, options?: any) => {
    if (data instanceof ArrayBuffer) {
      const durationSec = data.byteLength / BYTES_PER_SEC;

      if (data.byteLength < MIN_AUDIO_BYTES) {
        console.log(
          `[WhisperPatch] Skipping short audio: ${durationSec.toFixed(1)}s (${data.byteLength} bytes < ${MIN_AUDIO_BYTES} min)`,
        );
        return emptyTranscribeResult();
      }

      const base64 = int16PcmToBase64(data);
      console.log(
        `[WhisperPatch] Transcribing ${durationSec.toFixed(1)}s (${data.byteLength} bytes → ${base64.length} chars base64)`,
      );
      return original(base64, options);
    }
    return original(data, options);
  };

  return ctx;
}

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

    const ctx = await initWhisper({
      filePath: modelFilePath,
      useGpu: true,
      useFlashAttn: true,
    });

    // Patch transcribeData to fall back to base64 bridge path
    // when JSI bindings aren't available
    this.context = patchContextForBridgeFallback(ctx);

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
      // Short slices for near-realtime feedback: transcribe every ~5 seconds
      audioSliceSec: 5,
      audioMinSec: 3,
      maxSlicesInMemory: 5,
      transcribeOptions: {
        language: 'ar',
        maxLen: 1,        // segment by word for word-level tracking
        tokenTimestamps: true,
        wordThold: 0.6,
        prompt: 'بسم الله الرحمن الرحيم',  // Bias model toward Quran Arabic
      },
      // VAD is disabled (no vadContext provided) — slices fire on duration alone
      autoSliceOnSpeechEnd: false,
      // IMPORTANT: disabled — previous-slice prompting causes hallucination
      // feedback loops when any slice hallucinates (each subsequent slice
      // repeats the hallucinated text because it's used as prompt context).
      promptPreviousSlices: false,
      logger: (msg: string) => console.log(`[WhisperRT] ${msg}`),
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
      const t = this.transcriber;
      this.transcriber = null;
      try {
        await t.stop();
      } catch (e) {
        console.warn('[WhisperService] Error during transcription stop:', e);
      }
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
