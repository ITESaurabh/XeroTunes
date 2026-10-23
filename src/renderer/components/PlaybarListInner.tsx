import React from 'react';
import { SCROLL_HIDE_THRESHOLD } from '../utils/useScrollHidePlayerBar';

/** How much of a page the floating player bar covers while it is shown. */
export const PLAYBAR_SPACE = 220;

/**
 * react-window inner element with room at the end, so the last rows can scroll clear of the bar.
 * The bar hides past SCROLL_HIDE_THRESHOLD, so the room only has to reach it.
 * 100% resolves against the scroller's height.
 */
const PlaybarListInner = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ style, ...rest }, ref) => {
    const h = Number(style?.height ?? 0);
    const room = `clamp(0px, ${SCROLL_HIDE_THRESHOLD + 1 - h}px + 100%, ${PLAYBAR_SPACE}px)`;
    return <div ref={ref} style={{ ...style, height: `calc(${h}px + ${room})` }} {...rest} />;
  }
);
PlaybarListInner.displayName = 'PlaybarListInner';

export default PlaybarListInner;
