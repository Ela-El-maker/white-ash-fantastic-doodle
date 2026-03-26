import crypto from 'node:crypto';

export function newAssetId(): string {
  return crypto.randomUUID();
}
