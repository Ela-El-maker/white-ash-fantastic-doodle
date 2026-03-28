import path from 'node:path';
import { AssetKind, ProcessingContext, VideoRendition } from '../../types.js';
import { FfmpegMediaEngine } from '../ffmpeg-media-engine.js';
import { AssetProcessingPatch, AssetProcessor } from './asset-processor.js';

export class VideoProcessor implements AssetProcessor {
    constructor(private readonly mediaEngine: FfmpegMediaEngine) { }

    supports(kind: AssetKind): boolean {
        return kind === 'video';
    }

    async process(context: ProcessingContext): Promise<AssetProcessingPatch> {
        const { asset, abortSignal } = context;
        const assetDir = path.dirname(asset.originalPath);
        const outputPath = path.join(assetDir, 'video.mp4');
        const thumbnailPath = path.join(assetDir, 'thumb.jpg');

        const metadata = await this.mediaEngine.probe(asset.originalPath, abortSignal);
        await this.mediaEngine.transcodeToPlayback(asset.originalPath, outputPath, abortSignal);

        try {
            await this.mediaEngine.generateThumbnail(outputPath, thumbnailPath, abortSignal);
        } catch (error) {
            if (metadata.duration !== null && metadata.duration < 1) {
                await this.mediaEngine.generateThumbnail(asset.originalPath, thumbnailPath, abortSignal);
            } else {
                throw error;
            }
        }

        const normalized = await this.mediaEngine.probe(outputPath, abortSignal);
        const bitrate = await this.mediaEngine.statBitrateKbps(outputPath, normalized.duration);
        const rendition: VideoRendition = {
            url: '',
            width: normalized.width ?? 0,
            height: normalized.height ?? 0,
            bitrate,
        };

        return {
            processedPath: outputPath,
            thumbnailPath,
            durationSeconds: normalized.duration,
            width: normalized.width,
            height: normalized.height,
            codecVideo: normalized.codecVideo,
            codecAudio: normalized.codecAudio,
            renditions: [rendition],
        };
    }
}
