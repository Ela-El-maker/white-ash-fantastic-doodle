export type AssetStatus = 'queued' | 'uploading' | 'processing' | 'ready' | 'failed';

export type AssetKind =
  | 'video'
  | 'image'
  | 'pdf'
  | 'document'
  | 'spreadsheet'
  | 'archive'
  | 'supplementary';

export interface VideoRendition {
  url: string;
  width: number;
  height: number;
  bitrate: number;
}

export interface AssetRecord {
  id: string;
  kind: AssetKind;
  status: AssetStatus;
  progress: number;
  originalName: string;
  extension: string;
  mimeType: string;
  sizeBytes: number;

  originalPath: string;
  processedPath: string | null;
  previewPath: string | null;
  thumbnailPath: string | null;

  originalUrl: string | null;
  previewUrl: string | null;
  thumbnailUrl: string | null;
  downloadUrl: string | null;

  width: number | null;
  height: number | null;
  durationSeconds: number | null;
  pageCount: number | null;

  codecVideo: string | null;
  codecAudio: string | null;
  renditions: VideoRendition[];

  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AssetResponse {
  id: string;
  kind: AssetKind;
  status: AssetStatus;
  progress: number;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  originalUrl: string | null;
  previewUrl: string | null;
  thumbnailUrl: string | null;
  downloadUrl: string | null;
  width: number | null;
  height: number | null;
  durationSeconds: number | null;
  pageCount: number | null;
  renditions: VideoRendition[];
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface VideoAssetResponse {
  id: string;
  status: AssetStatus;
  progress: number;
  playbackUrl: string | null;
  thumbnailUrl: string | null;
  duration: number | null;
  renditions: VideoRendition[];
  error: string | null;
}

export interface ClassifiedAsset {
  kind: AssetKind;
  mimeType: string;
  extension: string;
  signature: AssetSignature;
}

export type AssetSignature =
  | 'mp4'
  | 'jpg'
  | 'png'
  | 'gif'
  | 'webp'
  | 'pdf'
  | 'zip'
  | 'unknown';

export interface ProbeMetadata {
  duration: number | null;
  width: number | null;
  height: number | null;
  codecVideo: string | null;
  codecAudio: string | null;
}

export interface ImageMetadata {
  width: number | null;
  height: number | null;
  format: 'jpg' | 'png' | 'gif' | 'webp' | null;
}

export interface ProcessingContext {
  asset: AssetRecord;
  abortSignal?: AbortSignal;
}
