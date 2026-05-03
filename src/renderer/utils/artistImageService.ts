import { QueryClient } from '@tanstack/react-query';
import { getArtistImageFetchingEnabled } from './LocStoreUtil';

const FETCH_DELAY_MS = 2000;

type ArtistRecord = {
  Id?: number;
  ProfileImgUri?: string | null;
  ProfileImg?: string | null;
};

export interface ArtistImageFetchItem {
  artistId: number;
  queryClient: QueryClient;
  queryKey: unknown[];
}

class ArtistImageService {
  private queue: ArtistImageFetchItem[] = [];
  private queuedIds = new Set<number>();
  private processing = false;

  private wait(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  public enqueue(artistId: number, queryClient: QueryClient, queryKey: unknown[]): void {
    if (!getArtistImageFetchingEnabled()) return;
    if (!artistId || this.queuedIds.has(artistId)) return;

    this.queuedIds.add(artistId);
    this.queue.push({ artistId, queryClient, queryKey });
    this.processQueue();
  }

  private async processQueue(): Promise<void> {
    if (this.processing) return;
    this.processing = true;

    while (this.queue.length > 0) {
      const item = this.queue.shift();
      if (!item) break;
      this.queuedIds.delete(item.artistId);

      try {
        const queryData = item.queryClient.getQueryData<ArtistRecord[]>(item.queryKey);
        if (!Array.isArray(queryData)) {
          await this.wait(FETCH_DELAY_MS);
          continue;
        }

        const artist = queryData.find(record => record?.Id === item.artistId);
        if (!artist || artist.ProfileImgUri) {
          await this.wait(FETCH_DELAY_MS);
          continue;
        }

        const result = await item.queryClient.fetchQuery({
          queryKey: ['artist-profile-image', item.artistId],
          queryFn: async () => {
            const response = await window
              .require('electron')
              .ipcRenderer.invoke('fetch-artist-profile-image', {
                artistId: item.artistId,
              });
            return response as string | null;
          },
          staleTime: Infinity,
        });

        if (typeof result === 'string' && result) {
          item.queryClient.setQueryData<ArtistRecord[]>(item.queryKey, old =>
            Array.isArray(old)
              ? old.map(a =>
                  a?.Id === item.artistId ? { ...a, ProfileImgUri: result, ProfileImg: result } : a
                )
              : old
          );
        }
      } catch {
        // ignore fetch failures and keep processing
      }

      await this.wait(FETCH_DELAY_MS);
    }

    this.processing = false;
  }
}

export const artistImageService = new ArtistImageService();
