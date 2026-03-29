import fs from 'node:fs/promises';
import { createCanvas } from '@napi-rs/canvas';
import sharp from 'sharp';
import { ImageMetadata } from '../../types.js';

const THUMBNAIL_MAX_WIDTH = 320;
const THUMBNAIL_MAX_HEIGHT = 320;
const PDF_RENDER_SCALE = 1.5;

export class MediaToolchain {
    async extractImageMetadata(filePath: string): Promise<ImageMetadata> {
        const metadata = await sharp(filePath, { failOn: 'error' }).metadata();
        return {
            width: metadata.width ?? null,
            height: metadata.height ?? null,
            format: normalizeImageFormat(metadata.format),
        };
    }

    async generateImageThumbnail(inputPath: string, outputPath: string): Promise<void> {
        await sharp(inputPath, { failOn: 'error' })
            .rotate()
            .resize({
                width: THUMBNAIL_MAX_WIDTH,
                height: THUMBNAIL_MAX_HEIGHT,
                fit: 'inside',
                withoutEnlargement: true,
            })
            .jpeg({ quality: 82, mozjpeg: true })
            .toFile(outputPath);
    }

    async extractPdfPageCount(filePath: string): Promise<number | null> {
        const { document } = await this.loadPdfDocument(filePath);
        const pageCount = Number.isFinite(document.numPages) ? document.numPages : null;
        await document.destroy();
        return pageCount;
    }

    async generatePdfFirstPageThumbnail(filePath: string, outputPath: string): Promise<void> {
        const { document } = await this.loadPdfDocument(filePath);
        const page = await document.getPage(1);

        const viewport = page.getViewport({ scale: PDF_RENDER_SCALE });
        const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
        const context = canvas.getContext('2d');

        await page.render({
            canvasContext: context,
            viewport,
        }).promise;

        const rendered = canvas.toBuffer('image/png');
        await sharp(rendered, { failOn: 'error' })
            .resize({
                width: THUMBNAIL_MAX_WIDTH,
                height: THUMBNAIL_MAX_HEIGHT,
                fit: 'inside',
                withoutEnlargement: true,
            })
            .jpeg({ quality: 82, mozjpeg: true })
            .toFile(outputPath);

        await page.cleanup();
        await document.cleanup();
        await document.destroy();
    }

    private async loadPdfDocument(filePath: string): Promise<{ document: any }> {
        const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs') as any;
        const bytes = await fs.readFile(filePath);

        const loadingTask = pdfjs.getDocument({ data: new Uint8Array(bytes) });

        const document = await loadingTask.promise;
        return { document };
    }
}

function normalizeImageFormat(format: string | undefined): ImageMetadata['format'] {
    if (!format) {
        return null;
    }

    const normalized = format.toLowerCase();
    if (normalized === 'jpeg' || normalized === 'jpg') {
        return 'jpg';
    }
    if (normalized === 'png') {
        return 'png';
    }
    if (normalized === 'gif') {
        return 'gif';
    }
    if (normalized === 'webp') {
        return 'webp';
    }

    return null;
}
