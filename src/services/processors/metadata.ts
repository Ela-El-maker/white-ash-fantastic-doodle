import fs from 'node:fs/promises';
import path from 'node:path';
import { ImageMetadata } from '../../types.js';

export async function extractImageMetadata(filePath: string): Promise<ImageMetadata> {
    const bytes = await fs.readFile(filePath);
    const extension = path.extname(filePath).toLowerCase().replace('.', '');

    if (extension === 'png') {
        if (bytes.length < 24) {
            return { width: null, height: null, format: 'png' };
        }

        return {
            width: bytes.readUInt32BE(16),
            height: bytes.readUInt32BE(20),
            format: 'png',
        };
    }

    if (extension === 'gif') {
        if (bytes.length < 10) {
            return { width: null, height: null, format: 'gif' };
        }

        return {
            width: bytes.readUInt16LE(6),
            height: bytes.readUInt16LE(8),
            format: 'gif',
        };
    }

    if (extension === 'webp') {
        return parseWebpDimensions(bytes);
    }

    if (extension === 'jpg' || extension === 'jpeg') {
        return parseJpegDimensions(bytes);
    }

    return { width: null, height: null, format: null };
}

export async function estimatePdfPageCount(filePath: string): Promise<number | null> {
    const bytes = await fs.readFile(filePath);
    const text = bytes.toString('latin1');
    const matches = text.match(/\/Type\s*\/Page(?!s)\b/g);
    if (!matches || matches.length === 0) {
        return null;
    }

    return matches.length;
}

function parseJpegDimensions(bytes: Buffer): ImageMetadata {
    let offset = 2;
    while (offset + 9 < bytes.length) {
        if (bytes[offset] !== 0xff) {
            offset += 1;
            continue;
        }

        const marker = bytes[offset + 1];
        const isSof = marker === 0xc0 || marker === 0xc1 || marker === 0xc2 || marker === 0xc3;
        const length = bytes.readUInt16BE(offset + 2);

        if (isSof && offset + 8 < bytes.length) {
            return {
                width: bytes.readUInt16BE(offset + 7),
                height: bytes.readUInt16BE(offset + 5),
                format: 'jpg',
            };
        }

        if (length < 2) {
            break;
        }

        offset += 2 + length;
    }

    return { width: null, height: null, format: 'jpg' };
}

function parseWebpDimensions(bytes: Buffer): ImageMetadata {
    if (bytes.length < 30) {
        return { width: null, height: null, format: 'webp' };
    }

    const chunkType = bytes.subarray(12, 16).toString('ascii');
    if (chunkType === 'VP8X') {
        const widthMinusOne = bytes.readUInt8(24) | (bytes.readUInt8(25) << 8) | (bytes.readUInt8(26) << 16);
        const heightMinusOne = bytes.readUInt8(27) | (bytes.readUInt8(28) << 8) | (bytes.readUInt8(29) << 16);
        return {
            width: widthMinusOne + 1,
            height: heightMinusOne + 1,
            format: 'webp',
        };
    }

    if (chunkType === 'VP8 ') {
        const width = bytes.readUInt16LE(26) & 0x3fff;
        const height = bytes.readUInt16LE(28) & 0x3fff;
        return { width, height, format: 'webp' };
    }

    if (chunkType === 'VP8L') {
        const b0 = bytes.readUInt8(21);
        const b1 = bytes.readUInt8(22);
        const b2 = bytes.readUInt8(23);
        const b3 = bytes.readUInt8(24);
        const width = 1 + (((b1 & 0x3f) << 8) | b0);
        const height = 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6));
        return { width, height, format: 'webp' };
    }

    return { width: null, height: null, format: 'webp' };
}
