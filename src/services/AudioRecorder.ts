/**
 * AudioRecorder — wraps @fugood/react-native-audio-pcm-stream to provide
 * a clean interface for streaming 16-bit PCM audio at 16 kHz mono,
 * which is what Whisper expects.
 */
import { AudioPcmStreamAdapter } from 'whisper.rn/realtime-transcription/adapters/AudioPcmStreamAdapter';
import type {
  AudioStreamInterface,
  AudioStreamData,
  AudioStreamConfig,
} from 'whisper.rn/realtime-transcription/types';

const DEFAULT_CONFIG: AudioStreamConfig = {
  sampleRate: 16000,
  channels: 1,
  bitsPerSample: 16,
  bufferSize: 8192,
  audioSource: 6, // VOICE_RECOGNITION on Android
};

export class AudioRecorder {
  private stream: AudioStreamInterface;
  private onDataCallbacks: Array<(data: AudioStreamData) => void> = [];
  private onErrorCallbacks: Array<(error: string) => void> = [];

  constructor() {
    this.stream = new AudioPcmStreamAdapter();
  }

  async init(config?: Partial<AudioStreamConfig>): Promise<void> {
    const mergedConfig = { ...DEFAULT_CONFIG, ...config };

    this.stream.onData((data) => {
      this.onDataCallbacks.forEach((cb) => cb(data));
    });

    this.stream.onError((error) => {
      this.onErrorCallbacks.forEach((cb) => cb(error));
    });

    await this.stream.initialize(mergedConfig);
  }

  async start(): Promise<void> {
    await this.stream.start();
  }

  async stop(): Promise<void> {
    await this.stream.stop();
  }

  isRecording(): boolean {
    return this.stream.isRecording();
  }

  onData(callback: (data: AudioStreamData) => void): void {
    this.onDataCallbacks.push(callback);
  }

  onError(callback: (error: string) => void): void {
    this.onErrorCallbacks.push(callback);
  }

  async release(): Promise<void> {
    this.onDataCallbacks = [];
    this.onErrorCallbacks = [];
    await this.stream.release();
  }
}
