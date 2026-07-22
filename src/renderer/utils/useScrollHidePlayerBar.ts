import { useRef, useContext, useCallback } from 'react';
import { store } from './store';

/**
 * Returns an `onScroll` handler that hides the player bar when scrolling down
 * past `threshold` px and reveals it when scrolling back up or near the top.
 *
 * Compatible with both react-window `FixedSizeList` (passes `scrollOffset`)
 * and `FixedSizeGrid` (passes `scrollTop`) — supply the correct field via the
 * `field` option (default: `'scrollOffset'`).
 *
 * Usage – FixedSizeList:
 *   const onScroll = useScrollHidePlayerBar();
 *   <FixedSizeList onScroll={onScroll} ... />
 *
 * Usage – FixedSizeGrid:
 *   const onScroll = useScrollHidePlayerBar({ field: 'scrollTop' });
 *   <FixedSizeGrid onScroll={onScroll} ... />
 */
export function useScrollHidePlayerBar<T extends Record<string, number>>(
  options: { threshold?: number; field?: keyof T } = {}
): (_args: T) => void {
  const { threshold = 250, field = 'scrollOffset' as keyof T } = options;
  const { state, dispatch } = useContext(store);
  const lastPos = useRef<number>(0);

  return useCallback(
    (args: T) => {
      // Don't hide the player bar while lyrics panel is open
      if (state.isLyricsExpanded) return;
      const pos = args[field] as number;
      if (pos > threshold) {
        if (pos > lastPos.current) {
          dispatch({ type: 'SET_PLAYER_BAR_VISIBLE', payload: false });
        } else if (pos < lastPos.current) {
          dispatch({ type: 'SET_PLAYER_BAR_VISIBLE', payload: true });
        }
      } else {
        dispatch({ type: 'SET_PLAYER_BAR_VISIBLE', payload: true });
      }
      lastPos.current = pos;
    },
    [state.isLyricsExpanded, dispatch, threshold, field]
  );
}
