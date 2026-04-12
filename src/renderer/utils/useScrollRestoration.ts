import { useCallback, useEffect, useMemo, useRef, type MutableRefObject } from 'react';

const scrollPositions = new Map<string, number>();

export interface UseScrollRestorationResult {
  scrollRef: MutableRefObject<HTMLDivElement | null>;
  saveScrollPosition: (scrollTop: number) => void;
  initialScrollOffset: number;
  initialScrollTop: number;
}

export function useScrollRestoration(key: string, defaultOffset = 0): UseScrollRestorationResult {
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const initialScrollOffset = useMemo(() => {
    return scrollPositions.get(key) ?? defaultOffset;
  }, [key, defaultOffset]);

  useEffect(() => {
    const saved = scrollPositions.get(key);
    if (saved != null && scrollRef.current) {
      scrollRef.current.scrollTop = saved;
    }
  }, [key]);

  const saveScrollPosition = useCallback(
    (scrollTop: number) => {
      if (typeof scrollTop !== 'number' || Number.isNaN(scrollTop)) return;
      scrollPositions.set(key, scrollTop);
    },
    [key]
  );

  return {
    scrollRef,
    saveScrollPosition,
    initialScrollOffset,
    initialScrollTop: initialScrollOffset,
  };
}
