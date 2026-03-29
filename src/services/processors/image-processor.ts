import fs from 'node:fs/promises';
import path from 'node:path';
import { AssetKind, ProcessingContext } from '../../types.js';
import { AssetProcessingPatch, AssetProcessor } from './asset-processor.js';
import { MediaToolchain } from './media-toolchain.js';

export class ImageProcessor implements AssetProcessor {
    constructor(private readonly mediaToolchain: MediaToolchain) { }

    supports(kind: AssetKind): boolean {
        return kind === 'image';
    }

    async process(context: ProcessingContext): Promise<AssetProcessingPatch> {
        const { asset } = context;
        const assetDir = path.dirname(asset.originalPath);
        const extension = asset.extension || 'bin';
        const processedPath = path.join(assetDir, `image.${extension}`);
        const thumbnailPath = path.join(assetDir, 'thumb.jpg');

        await fs.copyFile(asset.originalPath, processedPath);
        await this.mediaToolchain.generateImageThumbnail(processedPath, thumbnailPath);

        const metadata = await this.mediaToolchain.extractImageMetadata(processedPath);

        return {
            processedPath,
            thumbnailPath,
            width: metadata.width,
            height: metadata.height,
            durationSeconds: null,
            pageCount: null,
            codecVideo: null,
            codecAudio: null,
            renditions: [],
        };
    }
}
