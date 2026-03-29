import fs from 'node:fs/promises';
import path from 'node:path';
import { AssetKind, ProcessingContext } from '../../types.js';
import { AssetProcessingPatch, AssetProcessor } from './asset-processor.js';
import { MediaToolchain } from './media-toolchain.js';

export class PdfProcessor implements AssetProcessor {
    constructor(private readonly mediaToolchain: MediaToolchain) { }

    supports(kind: AssetKind): boolean {
        return kind === 'pdf';
    }

    async process(context: ProcessingContext): Promise<AssetProcessingPatch> {
        const { asset } = context;
        const assetDir = path.dirname(asset.originalPath);
        const processedPath = path.join(assetDir, 'file.pdf');
        const thumbnailPath = path.join(assetDir, 'preview.jpg');

        await fs.copyFile(asset.originalPath, processedPath);
        await this.mediaToolchain.generatePdfFirstPageThumbnail(processedPath, thumbnailPath);

        const pageCount = await this.mediaToolchain.extractPdfPageCount(processedPath);

        return {
            processedPath,
            previewPath: processedPath,
            thumbnailPath,
            pageCount,
            width: null,
            height: null,
            durationSeconds: null,
            codecVideo: null,
            codecAudio: null,
            renditions: [],
        };
    }
}
