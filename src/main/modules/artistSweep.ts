import { PendingArtist, pendingArtists } from '../db/artists';
import { fetchArtistProfileImage } from './artistArts';

const FETCH_DELAY_MS = 3000;
const FAILURE_RETRY_MS = 60_000;
const IDLE_RESCAN_MS = 10 * 60_000;
const BATCH_SIZE = 200;

interface SweepOptions {
  isEnabled: () => boolean;
  onFetched: (_artistId: number, _uri: string | null) => void;
}

let started = false;
let wake: (() => void) | null = null;

const wait = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

/** Like wait(), but wakeArtistSweep() can cut it short. */
function idle(ms: number): Promise<void> {
  return new Promise(resolve => {
    const finish = () => {
      clearTimeout(timer);
      wake = null;
      resolve();
    };
    const timer = setTimeout(finish, ms);
    wake = finish;
  });
}

export function wakeArtistSweep(): void {
  wake?.();
}

/**
 * Runs for the life of the app, independent of which view is open, and re-queries
 * in batches so a later library scan's artists get picked up without a restart.
 */
export function startArtistSweep({ isEnabled, onFetched }: SweepOptions): void {
  if (started) return;
  started = true;

  void (async () => {
    let queue: PendingArtist[] = [];
    let consecutiveFailures = 0;

    for (;;) {
      if (!isEnabled()) {
        queue = [];
        await idle(FAILURE_RETRY_MS);
        continue;
      }

      if (queue.length === 0) {
        queue = pendingArtists(BATCH_SIZE);
        if (queue.length === 0) {
          await idle(IDLE_RESCAN_MS);
          continue;
        }
      }

      const artist = queue.shift()!;
      try {
        onFetched(artist.Id, await fetchArtistProfileImage(artist.Name, undefined, artist.Id));
        consecutiveFailures = 0;
        await wait(FETCH_DELAY_MS);
      } catch {
        // Retry in place while the failure still looks transient (offline), then
        // drop it; the row stays unstamped, so a later batch picks it up anyway.
        consecutiveFailures += 1;
        if (consecutiveFailures < 3) queue.unshift(artist);
        else consecutiveFailures = 0;
        await wait(FAILURE_RETRY_MS);
      }
    }
  })();
}
