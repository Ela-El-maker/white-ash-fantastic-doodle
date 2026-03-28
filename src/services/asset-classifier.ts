import path from 'node:path';
import { AssetKind, AssetSignature, ClassifiedAsset } from '../types.js';

export class AssetValidationError extends Error {
    public readonly statusCode: number;

    constructor(message: string, statusCode = 415) {
        super(message);
        this.statusCode = statusCode;
        this.name = 'AssetValidationError';
    }
}

type ClassificationRule = {
    kind: AssetKind;
    extension: string;
    canonicalMimeType: string;
    acceptedMimeTypes: readonly string[];
    acceptedSignatures: readonly AssetSignature[];
};

const MP4_RULE: ClassificationRule = {
    kind: 'video',
    extension: 'mp4',
    canonicalMimeType: 'video/mp4',
    acceptedMimeTypes: ['video/mp4'],
    acceptedSignatures: ['mp4'],
};

const JPG_RULE: ClassificationRule = {
    kind: 'image',
    extension: 'jpg',
    canonicalMimeType: 'image/jpeg',
    acceptedMimeTypes: ['image/jpeg', 'image/jpg'],
    acceptedSignatures: ['jpg'],
};

const PNG_RULE: ClassificationRule = {
    kind: 'image',
    extension: 'png',
    canonicalMimeType: 'image/png',
    acceptedMimeTypes: ['image/png'],
    acceptedSignatures: ['png'],
};

const GIF_RULE: ClassificationRule = {
    kind: 'image',
    extension: 'gif',
    canonicalMimeType: 'image/gif',
    acceptedMimeTypes: ['image/gif'],
    acceptedSignatures: ['gif'],
};

const WEBP_RULE: ClassificationRule = {
    kind: 'image',
    extension: 'webp',
    canonicalMimeType: 'image/webp',
    acceptedMimeTypes: ['image/webp'],
    acceptedSignatures: ['webp'],
};

const PDF_RULE: ClassificationRule = {
    kind: 'pdf',
    extension: 'pdf',
    canonicalMimeType: 'application/pdf',
    acceptedMimeTypes: ['application/pdf'],
    acceptedSignatures: ['pdf'],
};

const DOCX_RULE: ClassificationRule = {
    kind: 'document',
    extension: 'docx',
    canonicalMimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    acceptedMimeTypes: [
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/zip',
    ],
    acceptedSignatures: ['zip'],
};

const XLSX_RULE: ClassificationRule = {
    kind: 'spreadsheet',
    extension: 'xlsx',
    canonicalMimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    acceptedMimeTypes: [
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/zip',
    ],
    acceptedSignatures: ['zip'],
};

const ZIP_RULE: ClassificationRule = {
    kind: 'archive',
    extension: 'zip',
    canonicalMimeType: 'application/zip',
    acceptedMimeTypes: ['application/zip', 'application/x-zip-compressed'],
    acceptedSignatures: ['zip'],
};

const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp']);
const IMAGE_MIME_TO_EXTENSION = new Map<string, string>([
    ['image/jpeg', 'jpg'],
    ['image/png', 'png'],
    ['image/gif', 'gif'],
    ['image/webp', 'webp'],
]);

const RULES: Record<string, ClassificationRule> = {
    mp4: MP4_RULE,
    jpg: JPG_RULE,
    jpeg: JPG_RULE,
    png: PNG_RULE,
    gif: GIF_RULE,
    webp: WEBP_RULE,
    pdf: PDF_RULE,
    docx: DOCX_RULE,
    xlsx: XLSX_RULE,
    zip: ZIP_RULE,
};

const MIME_ONLY_RULES = new Map<string, ClassificationRule>([
    ['video/mp4', MP4_RULE],
    ['application/pdf', PDF_RULE],
    ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', DOCX_RULE],
    ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', XLSX_RULE],
    ['application/zip', ZIP_RULE],
    ['application/x-zip-compressed', ZIP_RULE],
]);

const PERMISSIVE_MIME_TYPES = new Set(['application/octet-stream', 'binary/octet-stream', '']);

export function classifyAsset(fileName: string, mimeType: string | undefined, bytes: Buffer): ClassifiedAsset {
    const normalizedMime = normalizeMimeType(mimeType);
    const extension = getExtension(fileName);
    const signature = detectSignature(bytes);

    const byExtension = RULES[extension];
    if (byExtension) {
        validateMime(normalizedMime, byExtension.acceptedMimeTypes, fileName);
        validateSignature(signature, byExtension.acceptedSignatures, fileName);

        return {
            kind: byExtension.kind,
            extension: byExtension.extension,
            mimeType: byExtension.canonicalMimeType,
            signature,
        };
    }

    if (IMAGE_EXTENSIONS.has(extension)) {
        throw new AssetValidationError(`Unsupported image type for ${fileName}.`, 415);
    }

    const imageExtensionFromMime = IMAGE_MIME_TO_EXTENSION.get(normalizedMime);
    if (imageExtensionFromMime) {
        const rule = RULES[imageExtensionFromMime];
        if (!rule) {
            throw new AssetValidationError(`Unsupported image type for ${fileName}.`, 415);
        }
        validateSignature(signature, rule.acceptedSignatures, fileName);
        return {
            kind: rule.kind,
            extension: rule.extension,
            mimeType: rule.canonicalMimeType,
            signature,
        };
    }

    const byMime = MIME_ONLY_RULES.get(normalizedMime);
    if (byMime) {
        validateSignature(signature, byMime.acceptedSignatures, fileName);
        return {
            kind: byMime.kind,
            extension: byMime.extension,
            mimeType: byMime.canonicalMimeType,
            signature,
        };
    }

    return {
        kind: 'supplementary',
        extension: extension || 'bin',
        mimeType: normalizedMime || 'application/octet-stream',
        signature,
    };
}

function normalizeMimeType(mimeType: string | undefined): string {
    if (!mimeType) {
        return '';
    }

    return mimeType.trim().toLowerCase();
}

function validateMime(mimeType: string, acceptedMimeTypes: readonly string[], fileName: string): void {
    if (PERMISSIVE_MIME_TYPES.has(mimeType)) {
        return;
    }

    if (acceptedMimeTypes.includes(mimeType)) {
        return;
    }

    throw new AssetValidationError(
        `MIME type mismatch for ${fileName}. Expected one of ${acceptedMimeTypes.join(', ')}.`,
        415,
    );
}

function validateSignature(
    signature: AssetSignature,
    acceptedSignatures: readonly AssetSignature[],
    fileName: string,
): void {
    if (acceptedSignatures.includes(signature)) {
        return;
    }

    throw new AssetValidationError(`File signature mismatch for ${fileName}.`, 415);
}

function getExtension(fileName: string): string {
    const ext = path.extname(fileName).toLowerCase().replace('.', '');
    return ext;
}

export function detectSignature(bytes: Buffer): AssetSignature {
    if (bytes.length < 4) {
        return 'unknown';
    }

    if (isMp4(bytes)) {
        return 'mp4';
    }

    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
        return 'jpg';
    }

    if (
        bytes[0] === 0x89
        && bytes[1] === 0x50
        && bytes[2] === 0x4e
        && bytes[3] === 0x47
        && bytes[4] === 0x0d
        && bytes[5] === 0x0a
        && bytes[6] === 0x1a
        && bytes[7] === 0x0a
    ) {
        return 'png';
    }

    const gifHeader = bytes.subarray(0, 6).toString('ascii');
    if (gifHeader === 'GIF87a' || gifHeader === 'GIF89a') {
        return 'gif';
    }

    if (bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') {
        return 'webp';
    }

    if (bytes.subarray(0, 5).toString('ascii') === '%PDF-') {
        return 'pdf';
    }

    if (bytes[0] === 0x50 && bytes[1] === 0x4b && (bytes[2] === 0x03 || bytes[2] === 0x05 || bytes[2] === 0x07)) {
        return 'zip';
    }

    return 'unknown';
}

function isMp4(bytes: Buffer): boolean {
    if (bytes.length < 12) {
        return false;
    }

    const boxType = bytes.subarray(4, 8).toString('ascii');
    if (boxType !== 'ftyp') {
        return false;
    }

    const brand = bytes.subarray(8, 12).toString('ascii');
    return ['isom', 'iso2', 'avc1', 'mp41', 'mp42', 'M4V '].includes(brand);
}
