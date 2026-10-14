export const formatTime = (time: number): string => {
  if (time && !isNaN(time)) {
    const minutes = Math.floor(time / 60);
    const formatMinutes = minutes < 10 ? `0${minutes}` : `${minutes}`;
    const seconds = Math.floor(time % 60);
    const formatSeconds = seconds < 10 ? `0${seconds}` : `${seconds}`;
    return `${formatMinutes}:${formatSeconds}`;
  }
  return '00:00';
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function debounce<T extends (...args: any[]) => void>(
  func: T,
  delay: number
): (...args: Parameters<T>) => void {
  let debounceTimer: ReturnType<typeof setTimeout>;
  return function (this: unknown, ...args: Parameters<T>) {
    const context = this as unknown;
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => func.apply(context, args), delay);
  };
}

// A queue entry is either a local path or a stream URL, so file:// only applies to the former.
export const toMediaSrc = (uriOrPath: string): string =>
  /^[a-z][a-z0-9+.-]*:\/\//i.test(uriOrPath)
    ? uriOrPath
    : `file:///${uriOrPath.replace(/\\/g, '/').replace(/^\/+/, '')}`;
