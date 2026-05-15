import React, { useLayoutEffect, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import { keyframes, styled } from '@mui/material/styles';

const marqueeScroll = keyframes({
  from: { transform: 'translate3d(0, 0, 0)' },
  to: { transform: 'translate3d(-50%, 0, 0)' },
});

const Viewport = styled(Box)({
  width: '100%',
  overflow: 'hidden',
  // Apply the animation only while hovered. Leaving removes the property so the
  // transform reverts to identity (translate 0) instead of freezing mid-scroll.
  '&:hover .marquee-track[data-overflowing="true"]': {
    animation: `${marqueeScroll} 20s linear infinite`,
  },
});

const Track = styled(Box, {
  shouldForwardProp: prop => prop !== 'overflowing',
})<{ overflowing: boolean }>(({ overflowing }) => ({
  display: 'inline-flex',
  flexWrap: 'nowrap',
  whiteSpace: 'nowrap',
  willChange: overflowing ? 'transform' : 'auto',
}));

const Segment = styled(Box, {
  shouldForwardProp: prop => prop !== 'spaced',
})<{ spaced: boolean }>(({ spaced }) => ({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 16,
  paddingRight: spaced ? 64 : 0,
  '&[aria-hidden="true"]': { pointerEvents: 'none' },
}));

interface MarqueeProps {
  text: string;
  children: React.ReactNode;
}

const Marquee = React.memo(function Marquee({ text, children }: MarqueeProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const segmentRef = useRef<HTMLDivElement>(null);
  const [overflowing, setOverflowing] = useState(false);

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const segment = segmentRef.current;
    if (!viewport || !segment) return;

    const measure = () => {
      // segment.scrollWidth includes its paddingRight when spaced — clamp by checking
      // raw content width via the first child's scroll size when present.
      const inner = segment.firstElementChild as HTMLElement | null;
      const contentWidth = inner ? inner.scrollWidth : segment.scrollWidth;
      setOverflowing(contentWidth > viewport.clientWidth + 1);
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(viewport);
    ro.observe(segment);
    return () => ro.disconnect();
  }, [text, children]);

  return (
    <Viewport ref={viewportRef}>
      <Track
        className="marquee-track"
        overflowing={overflowing}
        data-overflowing={overflowing ? 'true' : 'false'}
      >
        <Segment ref={segmentRef} spaced={overflowing}>
          {children}
        </Segment>
        {overflowing && (
          <Segment aria-hidden="true" spaced>
            {children}
          </Segment>
        )}
      </Track>
    </Viewport>
  );
});

export default Marquee;
