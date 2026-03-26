export type AssetStatus = 'queued' | 'uploading' | 'processing' | 'ready' | 'failed';

export interface VideoRendition {
  url: string;
  width: number;
  height: number;
  bitrate: number;
}

export interface VideoAsset {
  id: string;
  status: AssetStatus;
  progress: number;
  originalPath: string;
  outputPath: string | null;
  thumbnailPath: string | null;
  duration: number | null;
  width: number | null;
  height: number | null;
  codecVideo: string | null;
  codecAudio: string | null;
  playbackUrl: string | null;
  thumbnailUrl: string | null;
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

export interface ProbeMetadata {
  duration: number | null;
  width: number | null;
  height: number | null;
  codecVideo: string | null;
  codecAudio: string | null;
}

export interface ProcessingContext {
  assetId: string;
  originalPath: string;
  outputPath: string;
  thumbnailPath: string;
}
