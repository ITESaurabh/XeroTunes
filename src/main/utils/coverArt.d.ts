export const MAX_COVER_PX: number;

export const MAX_COVER_BYTES: number;

export function capCover(data: Buffer): Promise<Buffer>;

export function capStoredCovers(dir: string): Promise<number>;

export function imageSize(data: Buffer): Promise<{ width: number; height: number } | null>;
