import fs from 'node:fs';
import { Readable } from 'node:stream';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { randomUUID } from 'node:crypto';
import { config } from '../config.js';
import { VideoAssetRepository } from '../repository/video-asset-repository.js';
import { VideoAsset, VideoAssetResponse, VideoRendition } from '../types.js';
import { assetDir, ensureDir, joinUrl, removeIfExists } from '../utils/fs.js';
import { FfmpegMediaEngine, ProcessingCancelledError } from './ffmpeg-media-engine.js';

const STAGE_PROGRESS = {
  validation: 5,
  uploadStart: 5,
  uploadComplete: 20,
  metadataComplete: 30,
  transcodeComplete: 80,
  thumbnailComplete: 90,
  finalizeComplete: 100,
} as const;

export class UserInputError extends Error {
  public readonly statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.statusCode = statusCode;
    this.name = 'UserInputError';
  }
}

export class VideoPipelineService {
  private readonly abortControllers = new Map<string, AbortController>();

  constructor(
    private readonly repository: VideoAssetRepository,
    private readonly mediaEngine: FfmpegMediaEngine,
  ) {}

  async init(): Promise<void> {
    await ensureDir(config.dataRoot);
    await ensureDir(config.assetRoot);
    await this.mediaEngine.preflight();
  }

  async createUploadTarget(): Promise<VideoAsset> {
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    const assetDirectory = assetDir(config.assetRoot, id);
    await ensureDir(assetDirectory);

    const asset: VideoAsset = {
      id,
      status: 'queued',
      progress: 0,
      originalPath: path.join(assetDirectory, 'original.mp4'),
      outputPath: null,
      thumbnailPath: null,
      duration: null,
      width: null,
      height: null,
      codecVideo: null,
      codecAudio: null,
      playbackUrl: null,
      thumbnailUrl: null,
      renditions: [],
      error: null,
      createdAt,
      updatedAt: createdAt,
    };

    await this.repository.create(asset);
    return asset;
  }

  async ingestUpload(assetId: string, stream: Readable, mimeType: string | undefined): Promise<void> {
    const asset = this.getAssetOrThrow(assetId);
    const uploadStream = stream as Readable & { truncated?: boolean };

    if (mimeType !== 'video/mp4') {
      throw new UserInputError('Invalid file type. Only video/mp4 is allowed.', 415);
    }

    await this.transition(assetId, {
      status: 'uploading',
      progress: STAGE_PROGRESS.validation,
      error: null,
    });

    await ensureDir(path.dirname(asset.originalPath));

    const writeStream = fs.createWriteStream(asset.originalPath, { flags: 'w' });

    let uploadedBytes = 0;
    const maxBytes = config.maxUploadBytes;
    let uploadProgress: number = STAGE_PROGRESS.uploadStart;
    let uploadProgressChain: Promise<void> = Promise.resolve();

    stream.on('data', (chunk: Buffer) => {
      uploadedBytes += chunk.length;
      if (uploadedBytes > maxBytes) {
        stream.destroy(new UserInputError(`File exceeds ${maxBytes} bytes limit.`, 413));
        return;
      }

      const nextProgress = Math.min(
        STAGE_PROGRESS.uploadComplete - 1,
        STAGE_PROGRESS.uploadStart + Math.floor((uploadedBytes / maxBytes) * 15),
      );
      if (nextProgress <= uploadProgress) {
        return;
      }

      uploadProgress = nextProgress;
      const progressForUpdate = uploadProgress;
      uploadProgressChain = uploadProgressChain
        .then(async () => {
          await this.transition(assetId, {
            status: 'uploading',
            progress: progressForUpdate,
            error: null,
          });
        })
        .catch(() => {
          // Do not fail upload on best-effort progress update.
        });
    });

    try {
      await pipeline(uploadStream, writeStream);
      await uploadProgressChain;
    } catch (error) {
      await removeIfExists(asset.originalPath);
      const message = error instanceof UserInputError ? error.message : 'Failed to ingest upload stream';
      if (error instanceof UserInputError) {
        throw error;
      }
      throw new UserInputError(message, 400);
    }

    if (uploadStream.truncated) {
      await removeIfExists(asset.originalPath);
      throw new UserInputError(`File exceeds ${maxBytes} bytes limit.`, 413);
    }

    const stats = await fsp.stat(asset.originalPath);
    if (stats.size === 0) {
      throw new UserInputError('Uploaded file is empty.', 400);
    }

    if (stats.size > maxBytes) {
      await removeIfExists(asset.originalPath);
      throw new UserInputError(`File exceeds ${maxBytes} bytes limit.`, 413);
    }

    await this.transition(assetId, {
      status: 'queued',
      progress: STAGE_PROGRESS.uploadComplete,
      error: null,
    });
  }

  async processAsset(assetId: string): Promise<void> {
    const asset = this.getAssetOrThrow(assetId);
    const controller = new AbortController();
    this.abortControllers.set(assetId, controller);

    const outputPath = path.join(path.dirname(asset.originalPath), 'video.mp4');
    const thumbnailPath = path.join(path.dirname(asset.originalPath), 'thumb.jpg');

    try {
      await this.transition(assetId, {
        status: 'processing',
        progress: STAGE_PROGRESS.uploadComplete,
        error: null,
      });

      const metadata = await this.mediaEngine.probe(asset.originalPath, controller.signal);
      await this.transition(assetId, {
        status: 'processing',
        progress: STAGE_PROGRESS.metadataComplete,
        duration: metadata.duration,
        width: metadata.width,
        height: metadata.height,
        codecVideo: metadata.codecVideo,
        codecAudio: metadata.codecAudio,
        error: null,
      });

      await this.mediaEngine.transcodeToPlayback(asset.originalPath, outputPath, controller.signal);
      await this.transition(assetId, {
        status: 'processing',
        progress: STAGE_PROGRESS.transcodeComplete,
        outputPath,
        error: null,
      });

      try {
        await this.mediaEngine.generateThumbnail(outputPath, thumbnailPath, controller.signal);
      } catch (error) {
        if (metadata.duration !== null && metadata.duration < 1) {
          await this.mediaEngine.generateThumbnail(asset.originalPath, thumbnailPath, controller.signal);
        } else {
          throw error;
        }
      }

      await this.transition(assetId, {
        status: 'processing',
        progress: STAGE_PROGRESS.thumbnailComplete,
        thumbnailPath,
        error: null,
      });

      const normalized = await this.mediaEngine.probe(outputPath, controller.signal);
      const bitrate = await this.mediaEngine.statBitrateKbps(outputPath, normalized.duration);
      const rendition: VideoRendition = {
        url: joinUrl(config.baseUrl, `/assets/${assetId}/video.mp4`),
        width: normalized.width ?? 0,
        height: normalized.height ?? 0,
        bitrate,
      };

      await this.transition(assetId, {
        status: 'ready',
        progress: STAGE_PROGRESS.finalizeComplete,
        outputPath,
        thumbnailPath,
        duration: normalized.duration,
        width: normalized.width,
        height: normalized.height,
        codecVideo: normalized.codecVideo,
        codecAudio: normalized.codecAudio,
        playbackUrl: rendition.url,
        thumbnailUrl: joinUrl(config.baseUrl, `/assets/${assetId}/thumb.jpg`),
        renditions: [rendition],
        error: null,
      });
    } catch (error) {
      if (error instanceof ProcessingCancelledError) {
        await this.repository.updateIfExists(assetId, (current) => this.withUpdated(current, {
          status: 'failed',
          progress: current.progress,
          error: 'Processing cancelled',
        }));
        return;
      }

      const message = error instanceof Error ? error.message : 'Unknown processing error';
      await this.failAsset(assetId, message);
    } finally {
      this.abortControllers.delete(assetId);
    }
  }

  async cancelAndDelete(assetId: string): Promise<boolean> {
    const existing = this.repository.get(assetId);
    if (!existing) {
      return false;
    }

    this.abortControllers.get(assetId)?.abort();
    await removeIfExists(path.dirname(existing.originalPath));
    await this.repository.delete(assetId);
    return true;
  }

  async discardAsset(assetId: string): Promise<void> {
    const existing = this.repository.get(assetId);
    if (!existing) {
      return;
    }

    await removeIfExists(path.dirname(existing.originalPath));
    await this.repository.delete(assetId);
  }

  getAsset(assetId: string): VideoAssetResponse | null {
    const asset = this.repository.get(assetId);
    if (!asset) {
      return null;
    }
    return this.toResponse(asset);
  }

  getAssetOrThrow(assetId: string): VideoAsset {
    const asset = this.repository.get(assetId);
    if (!asset) {
      throw new UserInputError('Asset not found', 404);
    }
    return asset;
  }

  private async failAsset(assetId: string, error: string): Promise<void> {
    await this.repository.updateIfExists(assetId, (current) => this.withUpdated(current, {
      status: 'failed',
      error,
      progress: current.progress,
    }));
  }

  private async transition(assetId: string, patch: Partial<VideoAsset>): Promise<void> {
    const updated = await this.repository.updateIfExists(assetId, (current) => this.withUpdated(current, patch));
    if (!updated) {
      throw new UserInputError('Asset not found', 404);
    }
  }

  private withUpdated(current: VideoAsset, patch: Partial<VideoAsset>): VideoAsset {
    return {
      ...current,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
  }

  private toResponse(asset: VideoAsset): VideoAssetResponse {
    return {
      id: asset.id,
      status: asset.status,
      progress: asset.progress,
      playbackUrl: asset.playbackUrl,
      thumbnailUrl: asset.thumbnailUrl,
      duration: asset.duration,
      renditions: asset.renditions,
      error: asset.error,
    };
  }
}
