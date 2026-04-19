/**
 * WhisperService — manages Whisper model lifecycle and provides
 * real-time transcription with speech-only audio accumulation.
 *
 * Key features:
 * - Initializes a WhisperContext from a downloaded .bin model file
 * - Uses AudioPcmStreamAdapter directly (no RealtimeTranscriber)
 * - Scans incoming PCM in 100ms frames, discards silence
 * - Accumulates voiced frames until target duration is reached
 * - Configurable target duration (5s for seeking, 1s for tracking)
 */
import {
  initWhisper,
  type WhisperContext,
  type TranscribeResult,
} from 'whisper.rn/index';
import { AudioPcmStreamAdapter } from 'whisper.rn/realtime-transcription/adapters/AudioPcmStreamAdapter';
import type { AudioStreamData } from 'whisper.rn/realtime-transcription/types';

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

/** Bytes per second for 16-bit mono 16 kHz PCM. */
const BYTES_PER_SEC = 16000 * 2;
/** 100ms frame size in bytes (16kHz × 2 bytes × 0.1s = 3200). */
const FRAME_BYTES = 3200;
/**
 * RMS threshold for a 100ms frame to be considered "voiced".
 * Int16 range is -32768..32767. Typical quiet room noise is ~200-500 RMS.
 * Speech is typically 1000+ RMS. 500 is a conservative threshold.
 */
const SILENCE_RMS_THRESHOLD = 500;

/**
 * Base64-encode raw int16 PCM audio for the native bridge.
 */
function int16PcmToBase64(bytes: Uint8Array): string {
  const CHUNK = 8192;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const slice = bytes.subarray(i, Math.min(i + CHUNK, bytes.length));
    binary += String.fromCharCode.apply(null, Array.from(slice));
  }
  return global.btoa(binary);
}

/**
 * Compute RMS (root mean square) energy of a 16-bit PCM buffer.
 * The input is a Uint8Array of little-endian int16 samples.
 */
function computeRMS(frame: Uint8Array): number {
  const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
  const sampleCount = frame.byteLength >> 1; // 2 bytes per sample
  if (sampleCount === 0) return 0;
  let sumSq = 0;
  for (let i = 0; i < sampleCount; i++) {
    const sample = view.getInt16(i * 2, true); // little-endian
    sumSq += sample * sample;
  }
  return Math.sqrt(sumSq / sampleCount);
}

export class WhisperService {
  private context: WhisperContext | null = null;
  private audioStream: AudioPcmStreamAdapter | null = null;
  private callbacks: WhisperServiceCallbacks = {};
  private modelPath: string = '';

  // ── Speech accumulator state ──
  /** Voiced frames waiting to be transcribed. */
  private speechBuffer: Uint8Array[] = [];
  /** Total byte count in speechBuffer. */
  private speechBufferBytes = 0;
  /** Target speech bytes before triggering inference. */
  private targetBytes = 5 * BYTES_PER_SEC; // default 5s (seeking)
  /** Leftover bytes from the stream that don't fill a complete 100ms frame. */
  private leftover: Uint8Array | null = null;
  /** Whether inference is currently running (prevents overlap). */
  private inferenceRunning = false;
  /** Whether we're actively capturing. */
  private capturing = false;

  /**
   * Initialize the Whisper context with a model file path.
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

  isReady(): boolean {
    return this.context !== null;
  }

  setCallbacks(callbacks: WhisperServiceCallbacks): void {
    this.callbacks = callbacks;
  }

  /**
   * Set the target speech duration (in seconds) for the accumulator.
   * Can be called while recording to switch between seeking (5s) and tracking (1s).
   */
  setTargetDuration(seconds: number): void {
    this.targetBytes = seconds * BYTES_PER_SEC;
    console.log(`[WhisperService] Target duration set to ${seconds}s (${this.targetBytes} bytes)`);
  }

  /**
   * Start real-time transcription with speech-only accumulation.
   */
  async startRealtimeTranscription(targetDurationSec = 5): Promise<void> {
    if (!this.context) {
      throw new Error('Whisper model not initialized. Call initModel() first.');
    }

    if (this.audioStream) {
      await this.stopRealtimeTranscription();
    }

    // Reset accumulator
    this.speechBuffer = [];
    this.speechBufferBytes = 0;
    this.targetBytes = targetDurationSec * BYTES_PER_SEC;
    this.leftover = null;
    this.inferenceRunning = false;
    this.capturing = true;

    this.audioStream = new AudioPcmStreamAdapter();

    await this.audioStream.initialize({
      sampleRate: 16000,
      channels: 1,
      bitsPerSample: 16,
      bufferSize: 16384,
      audioSource: 6,
    });

    this.audioStream.onData((streamData: AudioStreamData) => {
      if (!this.capturing) return;
      this.handleAudioData(streamData.data);
    });

    this.audioStream.onError((error: string) => {
      this.callbacks.onError?.(error);
    });

    await this.audioStream.start();
    console.log(`[WhisperService] Recording started — target ${targetDurationSec}s speech`);
  }

  /**
   * Stop recording and clean up.
   */
  async stopRealtimeTranscription(): Promise<void> {
    this.capturing = false;
    if (this.audioStream) {
      const stream = this.audioStream;
      this.audioStream = null;
      try {
        await stream.stop();
        await stream.release();
      } catch (e) {
        console.warn('[WhisperService] Error stopping audio stream:', e);
      }
    }
    this.speechBuffer = [];
    this.speechBufferBytes = 0;
    this.leftover = null;
  }

  /**
   * Process incoming raw PCM data: split into 100ms frames,
   * check each for voice activity, accumulate voiced frames.
   */
  private handleAudioData(data: Uint8Array): void {
    // Prepend any leftover from previous call
    let buffer: Uint8Array;
    if (this.leftover) {
      buffer = new Uint8Array(this.leftover.length + data.length);
      buffer.set(this.leftover, 0);
      buffer.set(data, this.leftover.length);
      this.leftover = null;
    } else {
      buffer = data;
    }

    let offset = 0;
    while (offset + FRAME_BYTES <= buffer.length) {
      const frame = buffer.subarray(offset, offset + FRAME_BYTES);
      offset += FRAME_BYTES;

      const rms = computeRMS(frame);
      if (rms >= SILENCE_RMS_THRESHOLD) {
        // Voiced frame — add to speech buffer
        this.speechBuffer.push(new Uint8Array(frame));
        this.speechBufferBytes += FRAME_BYTES;
      }
    }

    // Save leftover bytes that don't fill a complete frame
    if (offset < buffer.length) {
      this.leftover = new Uint8Array(buffer.subarray(offset));
    }

    // Check if we have enough speech to transcribe
    if (this.speechBufferBytes >= this.targetBytes && !this.inferenceRunning) {
      this.runInference();
    }
  }

  /**
   * Concatenate the speech buffer, send to Whisper, emit result.
   */
  private async runInference(): Promise<void> {
    if (!this.context || this.inferenceRunning) return;
    this.inferenceRunning = true;

    // Take the current buffer and reset
    const chunks = this.speechBuffer;
    const totalBytes = this.speechBufferBytes;
    this.speechBuffer = [];
    this.speechBufferBytes = 0;

    // Concatenate all voiced frames into one buffer
    const combined = new Uint8Array(totalBytes);
    let pos = 0;
    for (const chunk of chunks) {
      combined.set(chunk, pos);
      pos += chunk.length;
    }

    const durationSec = totalBytes / BYTES_PER_SEC;
    const base64 = int16PcmToBase64(combined);

    console.log(
      `[WhisperService] Inference START — ${durationSec.toFixed(1)}s speech (${totalBytes} bytes)`,
    );
    const inferenceStart = Date.now();

    try {
      const { promise } = this.context.transcribeData(base64, {
        language: 'ar',
        maxLen: 1,
        tokenTimestamps: true,
        wordThold: 0.6,
        prompt: 'بسم الله الرحمن الرحيم',
      });

      const res = await promise;
      const elapsedMs = Date.now() - inferenceStart;
      console.log(
        `[WhisperService] Inference DONE — ${elapsedMs}ms → "${(res.result ?? '').slice(0, 80)}"`,
      );

      if (this.capturing) {
        this.callbacks.onTranscription?.({
          text: res.result ?? '',
          segments: (res.segments ?? []).map(seg => ({
            text: seg.text,
            t0: seg.t0,
            t1: seg.t1,
          })),
          isCapturing: true,
        });
      }
    } catch (e) {
      console.warn('[WhisperService] Inference error:', e);
      this.callbacks.onError?.(
        e instanceof Error ? e.message : 'Inference failed',
      );
    } finally {
      this.inferenceRunning = false;
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
