/**
 * ModelManager — handles downloading, caching, and managing Whisper model files.
 *
 * Models are downloaded from Hugging Face (ggerganov/whisper.cpp)
 * and stored in the app's document directory.
 */
import RNFS from 'react-native-fs';

export type ModelSize = 'tiny' | 'base' | 'small' | 'medium';

export type ModelInfo = {
  size: ModelSize;
  label: string;
  fileName: string;
  url: string;
  diskSizeMB: number;
  description: string;
};

const MODELS: Record<ModelSize, ModelInfo> = {
  tiny: {
    size: 'tiny',
    label: 'Tiny (Fast, Less Accurate)',
    fileName: 'ggml-tiny.bin',
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.bin',
    diskSizeMB: 75,
    description: 'Fastest, basic Arabic support (~75 MB)',
  },
  base: {
    size: 'base',
    label: 'Base (Balanced)',
    fileName: 'ggml-base.bin',
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin',
    diskSizeMB: 142,
    description: 'Good balance of speed and accuracy (~142 MB)',
  },
  small: {
    size: 'small',
    label: 'Small (Recommended)',
    fileName: 'ggml-small.bin',
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin',
    diskSizeMB: 466,
    description: 'Good Arabic accuracy (~466 MB)',
  },
  medium: {
    size: 'medium',
    label: 'Medium (Best Accuracy)',
    fileName: 'ggml-medium.bin',
    url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.bin',
    diskSizeMB: 1530,
    description: 'Best Arabic accuracy, large download (~1.5 GB)',
  },
};

export type DownloadProgress = {
  bytesWritten: number;
  contentLength: number;
  percent: number;
};

export type DownloadCallbacks = {
  onProgress?: (progress: DownloadProgress) => void;
  onComplete?: (filePath: string) => void;
  onError?: (error: string) => void;
};

export class ModelManager {
  private modelsDir: string;
  private activeDownload: { jobId: number } | null = null;

  constructor() {
    this.modelsDir = `${RNFS.DocumentDirectoryPath}/whisper-models`;
  }

  /**
   * Ensure the models directory exists.
   */
  private async ensureModelsDir(): Promise<void> {
    const exists = await RNFS.exists(this.modelsDir);
    if (!exists) {
      await RNFS.mkdir(this.modelsDir);
    }
  }

  /**
   * Get the local file path for a given model size.
   */
  getModelPath(size: ModelSize): string {
    return `${this.modelsDir}/${MODELS[size].fileName}`;
  }

  /**
   * Check if a model is already downloaded.
   */
  async isModelDownloaded(size: ModelSize): Promise<boolean> {
    const path = this.getModelPath(size);
    return RNFS.exists(path);
  }

  /**
   * Get info about all available models and their download status.
   */
  async getAvailableModels(): Promise<
    Array<ModelInfo & { downloaded: boolean }>
  > {
    await this.ensureModelsDir();

    const results = await Promise.all(
      Object.values(MODELS).map(async (model) => ({
        ...model,
        downloaded: await this.isModelDownloaded(model.size),
      })),
    );

    return results;
  }

  /**
   * Download a Whisper model. Returns the local file path on success.
   */
  async downloadModel(
    size: ModelSize,
    callbacks?: DownloadCallbacks,
  ): Promise<string> {
    await this.ensureModelsDir();

    const model = MODELS[size];
    const destPath = this.getModelPath(size);

    // Check if already downloaded
    const exists = await RNFS.exists(destPath);
    if (exists) {
      callbacks?.onComplete?.(destPath);
      return destPath;
    }

    // Download with progress tracking
    const downloadResult = RNFS.downloadFile({
      fromUrl: model.url,
      toFile: destPath,
      progress: (res) => {
        const percent =
          res.contentLength > 0
            ? Math.round((res.bytesWritten / res.contentLength) * 100)
            : 0;
        callbacks?.onProgress?.({
          bytesWritten: res.bytesWritten,
          contentLength: res.contentLength,
          percent,
        });
      },
      progressDivider: 1,
      progressInterval: 500,
    });

    this.activeDownload = { jobId: downloadResult.jobId };

    try {
      const result = await downloadResult.promise;

      this.activeDownload = null;

      if (result.statusCode === 200) {
        callbacks?.onComplete?.(destPath);
        return destPath;
      } else {
        // Clean up partial download
        const partialExists = await RNFS.exists(destPath);
        if (partialExists) {
          await RNFS.unlink(destPath);
        }
        const errorMsg = `Download failed with status ${result.statusCode}`;
        callbacks?.onError?.(errorMsg);
        throw new Error(errorMsg);
      }
    } catch (error) {
      this.activeDownload = null;
      // Clean up partial download
      const partialExists = await RNFS.exists(destPath);
      if (partialExists) {
        await RNFS.unlink(destPath);
      }
      const errorMsg =
        error instanceof Error ? error.message : 'Download failed';
      callbacks?.onError?.(errorMsg);
      throw error;
    }
  }

  /**
   * Cancel an active download.
   */
  cancelDownload(): void {
    if (this.activeDownload) {
      RNFS.stopDownload(this.activeDownload.jobId);
      this.activeDownload = null;
    }
  }

  /**
   * Delete a downloaded model to free up space.
   */
  async deleteModel(size: ModelSize): Promise<void> {
    const path = this.getModelPath(size);
    const exists = await RNFS.exists(path);
    if (exists) {
      await RNFS.unlink(path);
    }
  }

  /**
   * Get the best available downloaded model (largest = best quality).
   */
  async getBestAvailableModel(): Promise<ModelSize | null> {
    const priority: ModelSize[] = ['medium', 'small', 'base', 'tiny'];
    for (const size of priority) {
      if (await this.isModelDownloaded(size)) {
        return size;
      }
    }
    return null;
  }
}
