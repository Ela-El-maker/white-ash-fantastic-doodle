import path from 'node:path';
import fs from 'node:fs/promises';
import { AssetKind, ProcessingContext } from '../../types.js';
import { AssetProcessingPatch, AssetProcessor } from './asset-processor.js';

const GENERIC_FILE_KINDS = new Set<AssetKind>(['document', 'spreadsheet', 'archive', 'supplementary']);

export class GenericFileProcessor implements AssetProcessor {
    supports(kind: AssetKind): boolean {
        return GENERIC_FILE_KINDS.has(kind);
    }

    async process(context: ProcessingContext): Promise<AssetProcessingPatch> {
        const { asset } = context;
        const assetDir = path.dirname(asset.originalPath);
        const extension = asset.extension || 'bin';
        const processedPath = path.join(assetDir, `file.${extension}`);

        await fs.copyFile(asset.originalPath, processedPath);

        return {
            processedPath,
            previewPath: null,
            thumbnailPath: null,
            width: null,
            height: null,
            durationSeconds: null,
            pageCount: null,
            codecVideo: null,
            codecAudio: null,
            renditions: [],
        };
    }
}
