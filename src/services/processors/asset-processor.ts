import { AssetKind, AssetRecord, ProcessingContext } from '../../types.js';

export type AssetProcessingPatch = Partial<AssetRecord>;

export interface AssetProcessor {
    supports(kind: AssetKind): boolean;
    process(context: ProcessingContext): Promise<AssetProcessingPatch>;
}
