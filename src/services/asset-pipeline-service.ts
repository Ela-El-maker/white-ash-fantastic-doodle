import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { config } from '../config.js';
import { AssetRepository } from '../repository/asset-repository.js';
import { AssetRecord, AssetResponse, VideoAssetResponse } from '../types.js';
import { assetDir, ensureDir, joinUrl, removeIfExists } from '../utils/fs.js';
import { classifyAsset, AssetValidationError, validateOfficePackage } from './asset-classifier.js';
import { FfmpegMediaEngine, ProcessingCancelledError } from './ffmpeg-media-engine.js';
import { AssetProcessor } from './processors/asset-processor.js';

const STAGE_PROGRESS = {
    validation: 5,
    uploadStart: 5,
    uploadComplete: 20,
    processingStart: 20,
    processingComplete: 90,
    finalizeComplete: 100,
} as const;

const MAX_SIGNATURE_BYTES = 16 * 1024;

export class UserInputError extends Error {
    public readonly statusCode: number;

    constructor(message: string, statusCode = 400) {
        super(message);
        this.statusCode = statusCode;
        this.name = 'UserInputError';
    }
}

export class AssetPipelineService {
    private readonly abortControllers = new Map<string, AbortController>();

    constructor(
        private readonly repository: AssetRepository,
        private readonly mediaEngine: FfmpegMediaEngine,
        private readonly processors: AssetProcessor[],
    ) { }

    async init(): Promise<void> {
        await ensureDir(config.dataRoot);
        await ensureDir(config.assetRoot);
        await this.mediaEngine.preflight();
    }

    async createUploadTarget(originalName: string, mimeType: string | undefined): Promise<AssetRecord> {
        const id = randomUUID();
        const createdAt = new Date().toISOString();
        const safeOriginalName = sanitizeFileName(originalName || 'upload.bin');
        const guessedExtension = normalizeExtension(path.extname(safeOriginalName).replace('.', '')) || 'bin';
        const assetDirectory = assetDir(config.assetRoot, id);
        await ensureDir(assetDirectory);

        const asset: AssetRecord = {
            id,
            kind: 'supplementary',
            status: 'queued',
            progress: 0,
            originalName: safeOriginalName,
            extension: guessedExtension,
            mimeType: normalizeMimeType(mimeType) || 'application/octet-stream',
            sizeBytes: 0,
            originalPath: path.join(assetDirectory, `original.${guessedExtension}`),
            processedPath: null,
            previewPath: null,
            thumbnailPath: null,
            originalUrl: null,
            previewUrl: null,
            thumbnailUrl: null,
            downloadUrl: null,
            width: null,
            height: null,
            durationSeconds: null,
            pageCount: null,
            codecVideo: null,
            codecAudio: null,
            renditions: [],
            error: null,
            createdAt,
            updatedAt: createdAt,
        };

        await this.repository.create(asset);
        return asset;
    }

    async ingestUpload(assetId: string, stream: Readable, mimeType: string | undefined): Promise<AssetRecord> {
        const asset = this.getAssetRecordOrThrow(assetId);
        const uploadStream = stream as Readable & { truncated?: boolean };

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
        const signatureChunks: Buffer[] = [];
        let signatureSize = 0;

        uploadStream.on('data', (chunk: Buffer) => {
            uploadedBytes += chunk.length;
            if (uploadedBytes > maxBytes) {
                uploadStream.destroy(new UserInputError(`File exceeds ${maxBytes} bytes limit.`, 413));
                return;
            }

            if (signatureSize < MAX_SIGNATURE_BYTES) {
                const needed = Math.min(chunk.length, MAX_SIGNATURE_BYTES - signatureSize);
                if (needed > 0) {
                    signatureChunks.push(chunk.subarray(0, needed));
                    signatureSize += needed;
                }
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
            await removeIfExists(asset.originalPath);
            throw new UserInputError('Uploaded file is empty.', 400);
        }

        if (stats.size > maxBytes) {
            await removeIfExists(asset.originalPath);
            throw new UserInputError(`File exceeds ${maxBytes} bytes limit.`, 413);
        }

        const signatureBytes = Buffer.concat(signatureChunks, signatureSize);
        let classified;
        try {
            classified = classifyAsset(asset.originalName, mimeType, signatureBytes);
        } catch (error) {
            await removeIfExists(asset.originalPath);
            if (error instanceof AssetValidationError) {
                throw new UserInputError(error.message, error.statusCode);
            }
            throw error;
        }

        const expectedOriginalPath = path.join(path.dirname(asset.originalPath), `original.${classified.extension}`);
        if (expectedOriginalPath !== asset.originalPath) {
            await fsp.rename(asset.originalPath, expectedOriginalPath);
        }

        if (classified.extension === 'docx' || classified.extension === 'xlsx') {
            try {
                await validateOfficePackage(expectedOriginalPath, classified.extension, asset.originalName);
            } catch (error) {
                await removeIfExists(expectedOriginalPath);
                if (error instanceof AssetValidationError) {
                    throw new UserInputError(error.message, error.statusCode);
                }
                throw error;
            }
        }

        return this.transition(assetId, {
            kind: classified.kind,
            extension: classified.extension,
            mimeType: classified.mimeType,
            originalPath: expectedOriginalPath,
            sizeBytes: stats.size,
            status: 'queued',
            progress: STAGE_PROGRESS.uploadComplete,
            error: null,
        });
    }

    async processAsset(assetId: string): Promise<void> {
        const initialAsset = this.getAssetRecordOrThrow(assetId);
        const controller = new AbortController();
        this.abortControllers.set(assetId, controller);

        try {
            const processingAsset = await this.transition(assetId, {
                status: 'processing',
                progress: STAGE_PROGRESS.processingStart,
                error: null,
            });

            const processor = this.selectProcessor(processingAsset.id, processingAsset.kind);
            const processedPatch = await processor.process({
                asset: processingAsset,
                abortSignal: controller.signal,
            });

            await this.transition(assetId, {
                ...processedPatch,
                status: 'processing',
                progress: STAGE_PROGRESS.processingComplete,
                error: null,
            });

            const latest = this.getAssetRecordOrThrow(assetId);
            const finalizedPatch = this.buildFinalPatch(latest.id, latest);
            await this.transition(assetId, {
                ...finalizedPatch,
                status: 'ready',
                progress: STAGE_PROGRESS.finalizeComplete,
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

    getAsset(assetId: string): AssetResponse | null {
        const asset = this.repository.get(assetId);
        if (!asset) {
            return null;
        }
        return this.toResponse(asset);
    }

    getVideoAsset(assetId: string): VideoAssetResponse | null {
        const asset = this.repository.get(assetId);
        if (!asset || asset.kind !== 'video') {
            return null;
        }

        return {
            id: asset.id,
            status: asset.status,
            progress: asset.progress,
            playbackUrl: asset.previewUrl ?? asset.originalUrl,
            thumbnailUrl: asset.thumbnailUrl,
            duration: asset.durationSeconds,
            renditions: asset.renditions,
            error: asset.error,
        };
    }

    getAssetRecordOrThrow(assetId: string): AssetRecord {
        const asset = this.repository.get(assetId);
        if (!asset) {
            throw new UserInputError('Asset not found', 404);
        }
        return asset;
    }

    resolveDownload(assetId: string): { filePath: string; fileName: string; mimeType: string } | null {
        const asset = this.repository.get(assetId);
        if (!asset || asset.status !== 'ready') {
            return null;
        }

        const filePath = asset.processedPath ?? asset.originalPath;
        return {
            filePath,
            fileName: asset.originalName,
            mimeType: asset.mimeType,
        };
    }

    resolveInline(assetId: string): { filePath: string; fileName: string; mimeType: string } | null {
        const asset = this.repository.get(assetId);
        if (!asset || asset.status !== 'ready') {
            return null;
        }

        if (asset.kind !== 'pdf') {
            return null;
        }

        const filePath = asset.previewPath ?? asset.processedPath ?? asset.originalPath;
        return {
            filePath,
            fileName: asset.originalName,
            mimeType: asset.mimeType,
        };
    }

    private selectProcessor(assetId: string, kind: AssetRecord['kind']): AssetProcessor {
        const processor = this.processors.find((candidate) => candidate.supports(kind));
        if (!processor) {
            throw new Error(`No processor registered for asset ${assetId} kind ${kind}`);
        }
        return processor;
    }

    private buildFinalPatch(assetId: string, asset: AssetRecord): Partial<AssetRecord> {
        const primaryPath = resolvePrimaryPath(asset);
        const originalUrl = primaryPath ? toAssetFileUrl(assetId, primaryPath) : null;
        const previewUrl = resolvePreviewUrl(assetId, asset, primaryPath);
        const thumbnailUrl = asset.thumbnailPath ? toAssetFileUrl(assetId, asset.thumbnailPath) : null;
        const downloadUrl = joinUrl(config.baseUrl, `/assets/${assetId}/download`);

        return {
            originalUrl,
            previewUrl,
            thumbnailUrl,
            downloadUrl,
            renditions: asset.renditions.map((rendition) => ({
                ...rendition,
                url: originalUrl ?? rendition.url,
            })),
        };
    }

    private async failAsset(assetId: string, error: string): Promise<void> {
        await this.repository.updateIfExists(assetId, (current) => this.withUpdated(current, {
            status: 'failed',
            error,
            progress: current.progress,
        }));
    }

    private async transition(assetId: string, patch: Partial<AssetRecord>): Promise<AssetRecord> {
        const updated = await this.repository.updateIfExists(assetId, (current) => this.withUpdated(current, patch));
        if (!updated) {
            throw new UserInputError('Asset not found', 404);
        }
        return updated;
    }

    private withUpdated(current: AssetRecord, patch: Partial<AssetRecord>): AssetRecord {
        return {
            ...current,
            ...patch,
            updatedAt: new Date().toISOString(),
        };
    }

    private toResponse(asset: AssetRecord): AssetResponse {
        return {
            id: asset.id,
            kind: asset.kind,
            status: asset.status,
            progress: asset.progress,
            originalName: asset.originalName,
            mimeType: asset.mimeType,
            sizeBytes: asset.sizeBytes,
            originalUrl: asset.originalUrl,
            previewUrl: asset.previewUrl,
            thumbnailUrl: asset.thumbnailUrl,
            downloadUrl: asset.downloadUrl,
            width: asset.width,
            height: asset.height,
            durationSeconds: asset.durationSeconds,
            pageCount: asset.pageCount,
            renditions: asset.renditions,
            error: asset.error,
            createdAt: asset.createdAt,
            updatedAt: asset.updatedAt,
        };
    }
}

function resolvePrimaryPath(asset: AssetRecord): string {
    if (asset.kind === 'video') {
        return asset.processedPath ?? asset.originalPath;
    }

    if (asset.kind === 'image') {
        return asset.processedPath ?? asset.originalPath;
    }

    if (asset.kind === 'pdf') {
        return asset.processedPath ?? asset.originalPath;
    }

    return asset.processedPath ?? asset.originalPath;
}

function resolvePreviewUrl(assetId: string, asset: AssetRecord, primaryPath: string | null): string | null {
    if (asset.kind === 'video') {
        return primaryPath ? toAssetFileUrl(assetId, primaryPath) : null;
    }

    if (asset.kind === 'image') {
        return primaryPath ? toAssetFileUrl(assetId, primaryPath) : null;
    }

    if (asset.kind === 'pdf') {
        return joinUrl(config.baseUrl, `/assets/${assetId}/inline`);
    }

    return null;
}

function toAssetFileUrl(assetId: string, filePath: string): string {
    return joinUrl(config.baseUrl, `/assets/${assetId}/${path.basename(filePath)}`);
}

function normalizeMimeType(mimeType: string | undefined): string {
    return mimeType?.trim().toLowerCase() ?? '';
}

function normalizeExtension(extension: string): string {
    return extension.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

function sanitizeFileName(fileName: string): string {
    return path.basename(fileName).replace(/[^a-zA-Z0-9._-]/g, '_');
}
