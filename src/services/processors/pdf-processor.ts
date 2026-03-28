import fs from 'node:fs/promises';
import path from 'node:path';
import { AssetKind, ProcessingContext } from '../../types.js';
import { AssetProcessingPatch, AssetProcessor } from './asset-processor.js';
import { estimatePdfPageCount } from './metadata.js';

export class PdfProcessor implements AssetProcessor {
    supports(kind: AssetKind): boolean {
        return kind === 'pdf';
    }

    async process(context: ProcessingContext): Promise<AssetProcessingPatch> {
        const { asset } = context;
        const assetDir = path.dirname(asset.originalPath);
        const processedPath = path.join(assetDir, 'file.pdf');

        await fs.copyFile(asset.originalPath, processedPath);

        const pageCount = await estimatePdfPageCount(processedPath);

        return {
            processedPath,
            previewPath: processedPath,
            thumbnailPath: null,
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
