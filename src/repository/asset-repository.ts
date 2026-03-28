import fs from 'node:fs/promises';
import path from 'node:path';
import { AssetRecord } from '../types.js';
import { ensureDir, fileExists } from '../utils/fs.js';

export class AssetRepository {
    private readonly items = new Map<string, AssetRecord>();
    private flushChain: Promise<void> = Promise.resolve();

    constructor(private readonly filePath: string) { }

    async init(): Promise<void> {
        await ensureDir(path.dirname(this.filePath));
        if (await fileExists(this.filePath)) {
            const raw = await fs.readFile(this.filePath, 'utf8');
            if (raw.trim().length > 0) {
                const parsed = JSON.parse(raw) as AssetRecord[];
                for (const item of parsed) {
                    this.items.set(item.id, item);
                }
            }
            return;
        }

        await this.flush();
    }

    async create(asset: AssetRecord): Promise<void> {
        this.items.set(asset.id, asset);
        await this.flush();
    }

    get(id: string): AssetRecord | undefined {
        return this.items.get(id);
    }

    list(): AssetRecord[] {
        return [...this.items.values()];
    }

    async update(id: string, updater: (current: AssetRecord) => AssetRecord): Promise<AssetRecord> {
        const next = await this.updateIfExists(id, updater);
        if (!next) {
            throw new Error(`Asset ${id} not found`);
        }
        return next;
    }

    async updateIfExists(id: string, updater: (current: AssetRecord) => AssetRecord): Promise<AssetRecord | null> {
        const current = this.items.get(id);
        if (!current) {
            return null;
        }

        const next = updater(current);
        this.items.set(id, next);
        await this.flush();
        return next;
    }

    async delete(id: string): Promise<void> {
        this.items.delete(id);
        await this.flush();
    }

    private async flush(): Promise<void> {
        this.flushChain = this.flushChain.then(async () => {
            const contents = JSON.stringify(this.list(), null, 2);
            await fs.writeFile(this.filePath, contents, 'utf8');
        });

        await this.flushChain;
    }
}
