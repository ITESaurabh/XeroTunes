import React, {
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import Box from '@mui/material/Box';
import { alpha, useTheme } from '@mui/material/styles';
import ArrowDropUpRounded from '@mui/icons-material/ArrowDropUpRounded';
import ArrowDropDownRounded from '@mui/icons-material/ArrowDropDownRounded';

import { store } from '../utils/store';
import type { ScrollSection } from '../utils/scrollSections';

interface FloatingScrollbarProps {
  /** The scrolling element. May not exist yet when this mounts. */
  targetRef: React.RefObject<HTMLElement | null>;
  /** Alphabet ticks and the drag bubble. Only meaningful for a sorted list. */
  sections?: ScrollSection[];
  /** Sit beside the scroller, not over it; the host must leave a `SCROLLBAR_RAIL` strip. */
  outside?: boolean;
  /** Portal target instead of the scroller's parent, for a scroller that owns its chrome. */
  hostRef?: React.RefObject<HTMLElement | null>;
  inset?: number;
  /** Keeps the rail clear of chrome floating over the bottom of the list. */
  bottomInset?: number;
}

/** Width of the rail. A scroller placing it `outside` must leave this much room. */
export const SCROLLBAR_RAIL = 14;
const RAIL = SCROLLBAR_RAIL;
const THUMB_THIN = 4;
const THUMB_FAT = 10;
const CARET = 20;
const MIN_THUMB = 28;
const HIDE_DELAY = 1100;
/** Distance from the rail's right edge that arms the expand, WinUI-style. */
const HOVER_ZONE = 26;
const LINE = 48;
/** Track-hold paging, in viewport-heights per second: start, ceiling, and ramp. */
const PAGE_FROM = 3;
const PAGE_TO = 18;
const PAGE_ACCEL = 30;
const BUBBLE = 44;
/** Frames to keep looking for a scroller that mounts late (AutoSizer, the data grid). */
const ATTACH_FRAMES = 180;

/** Everything that only changes on layout, not on every scroll tick. */
interface Metrics {
  scrollH: number;
  clientH: number;
  /** The scroller's own box within the host, which is not always the host's box. */
  offX: number;
  offY: number;
  clientW: number;
}

/**
 * Overlay scrollbar: floats over the content instead of taking a column from it,
 * hides when idle, and grows into a WinUI-style track with carets on hover. The rail
 * is portaled into the scroller's parent and placed from the scroller's own box.
 */
function FloatingScrollbar({
  targetRef,
  sections,
  outside = false,
  hostRef,
  inset = 2,
  bottomInset,
}: FloatingScrollbarProps) {
  const theme = useTheme();
  const { state } = useContext(store);
  const pinned = state.alwaysShowScrollbar;

  const [m, setM] = useState<Metrics>({ scrollH: 0, clientH: 0, offX: 0, offY: 0, clientW: 0 });
  const [idleVisible, setIdleVisible] = useState(false);
  const [hovering, setHovering] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [label, setLabel] = useState<string | null>(null);

  const hostEl = useRef<HTMLElement | null>(null);
  const railRef = useRef<HTMLDivElement | null>(null);
  const thumbRef = useRef<HTMLDivElement | null>(null);
  const bubbleRef = useRef<HTMLDivElement | null>(null);
  const hideTimer = useRef<number | undefined>(undefined);
  const frame = useRef(0);
  const drag = useRef<{ y: number; top: number; ratio: number } | null>(null);
  const hold = useRef<{ t?: number; i?: number }>({});
  const pagePointer = useRef(0);
  const pageTarget = useRef(0);
  const pageRaf = useRef(0);
  const pageRate = useRef(PAGE_FROM);
  // Read by syncThumb outside of a render, so a ref rather than state.
  const geom = useRef({ trackTop: 0, thumbLen: 0, travel: 1, overflow: 0 });
  const sectionsRef = useRef(sections);
  sectionsRef.current = sections;

  const measure = useCallback(() => {
    const el = targetRef.current;
    const host = hostEl.current;
    if (!el || !host) return;
    // A rect difference, not offsetLeft/offsetTop: offsetParent is whichever ancestor
    // happens to be positioned, rarely the element the rail is portaled into.
    const er = el.getBoundingClientRect();
    const hr = host.getBoundingClientRect();
    const offX = Math.round(er.left - hr.left - host.clientLeft + host.scrollLeft);
    const offY = Math.round(er.top - hr.top - host.clientTop + host.scrollTop);
    setM(prev =>
      prev.scrollH === el.scrollHeight &&
      prev.clientH === el.clientHeight &&
      prev.clientW === el.clientWidth &&
      prev.offX === offX &&
      prev.offY === offY
        ? prev
        : {
            scrollH: el.scrollHeight,
            clientH: el.clientHeight,
            clientW: el.clientWidth,
            offX,
            offY,
          }
    );
  }, [targetRef]);

  // A direct style write, not state: state would re-render every styled node in the
  // rail on each scroll frame.
  const syncThumb = useCallback(() => {
    const el = targetRef.current;
    if (!el) return;
    const { trackTop, thumbLen, travel, overflow } = geom.current;
    const top = trackTop + (overflow > 0 ? (el.scrollTop / overflow) * travel : 0);
    if (thumbRef.current) {
      thumbRef.current.style.transform = `translateY(${Math.round(top)}px)`;
    }
    if (bubbleRef.current) {
      bubbleRef.current.style.transform = `translateY(${Math.round(
        top + thumbLen / 2 - BUBBLE / 2
      )}px)`;
    }
    const list = sectionsRef.current;
    if (drag.current && list?.length) {
      const hit = list.reduce((acc, s) => (s.offset <= el.scrollTop + 4 ? s : acc), list[0]);
      setLabel(prev => (prev === hit.label ? prev : hit.label));
    }
  }, [targetRef]);

  useEffect(() => {
    let attachFrame = 0;
    let attempts = 0;
    let detach: (() => void) | undefined;

    const wire = (el: HTMLElement) => {
      el.classList.add('xt-scroll-host');

      const onScroll = () => {
        if (!frame.current) {
          frame.current = requestAnimationFrame(() => {
            frame.current = 0;
            syncThumb();
            measure();
          });
        }
        setIdleVisible(true);
        window.clearTimeout(hideTimer.current);
        hideTimer.current = window.setTimeout(() => setIdleVisible(false), HIDE_DELAY);
      };

      // Listened for on the parent, not the scroller: the rail is the scroller's
      // sibling, so the scroller fires mouseleave the moment the pointer reaches the
      // rail and it collapses before it can be grabbed.
      const onMove = (e: MouseEvent) => {
        const rail = railRef.current;
        if (!rail) return;
        const r = rail.getBoundingClientRect();
        setHovering(
          e.clientY >= r.top &&
            e.clientY <= r.bottom &&
            e.clientX >= r.right - HOVER_ZONE &&
            e.clientX <= r.right + 2
        );
      };
      const onLeave = () => setHovering(false);

      el.addEventListener('scroll', onScroll, { passive: true });

      // Portaled into the parent so it overlaps the content instead of scrolling with
      // it. AutoSizer's wrapper is a 0x0 box its child overflows; anchoring there
      // misplaces the rail and pushes phantom overflow onto whatever scrolls above,
      // so skip to a wrapper with a real box.
      let parent = hostRef?.current ?? el.parentElement;
      if (!hostRef?.current) {
        for (let i = 0; i < 4 && parent?.parentElement && parent.clientWidth === 0; i += 1) {
          parent = parent.parentElement;
        }
      }
      if (parent && getComputedStyle(parent).position === 'static') {
        parent.style.position = 'relative';
      }
      hostEl.current = parent;
      parent?.addEventListener('mousemove', onMove);
      parent?.addEventListener('mouseleave', onLeave);
      setHost(parent);

      const ro = new ResizeObserver(measure);
      ro.observe(el);
      if (parent) ro.observe(parent);
      if (el.firstElementChild) ro.observe(el.firstElementChild);

      measure();
      return () => {
        el.classList.remove('xt-scroll-host');
        el.removeEventListener('scroll', onScroll);
        parent?.removeEventListener('mousemove', onMove);
        parent?.removeEventListener('mouseleave', onLeave);
        ro.disconnect();
        hostEl.current = null;
        setHost(null);
      };
    };

    // AutoSizer and the data grid render their scroller only after measuring, so it
    // can arrive several frames after this effect.
    const attach = () => {
      const el = targetRef.current;
      if (!el) {
        if (attempts++ < ATTACH_FRAMES) attachFrame = requestAnimationFrame(attach);
        return;
      }
      detach = wire(el);
    };

    attach();
    return () => {
      cancelAnimationFrame(attachFrame);
      detach?.();
      window.clearTimeout(hideTimer.current);
      window.clearTimeout(hold.current.t);
      window.clearInterval(hold.current.i);
      if (frame.current) cancelAnimationFrame(frame.current);
      if (pageRaf.current) cancelAnimationFrame(pageRaf.current);
    };
  }, [targetRef, hostRef, measure, syncThumb]);

  const overflow = m.scrollH - m.clientH;
  const expanded = pinned || hovering || dragging;

  const cap = expanded ? CARET : 0;
  const trackTop = inset + cap;
  const trackLen = Math.max(0, m.clientH - inset - (bottomInset ?? inset) - cap * 2);
  const thumbLen = Math.max(MIN_THUMB, Math.round((m.clientH / (m.scrollH || 1)) * trackLen));
  const travel = Math.max(1, trackLen - thumbLen);
  geom.current = { trackTop, thumbLen, travel, overflow };

  // Expanding shrinks the track by two carets; reposition before the browser paints.
  useLayoutEffect(syncThumb, [syncThumb, expanded, m]);

  if (!host || overflow <= 1) return null;

  const shown = expanded || idleVisible;

  const onThumbDown = (e: React.PointerEvent) => {
    const el = targetRef.current;
    if (!el) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { y: e.clientY, top: el.scrollTop, ratio: overflow / travel };
    setDragging(true);
  };
  const onThumbMove = (e: React.PointerEvent) => {
    const el = targetRef.current;
    if (!drag.current || !el) return;
    el.scrollTop = drag.current.top + (e.clientY - drag.current.y) * drag.current.ratio;
  };
  const onThumbUp = (e: React.PointerEvent) => {
    drag.current = null;
    setDragging(false);
    setLabel(null);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  const startHold = (dir: 1 | -1) => {
    const el = targetRef.current;
    if (!el) return;
    const step = () => el.scrollBy({ top: dir * LINE });
    step();
    hold.current.t = window.setTimeout(() => {
      hold.current.i = window.setInterval(step, 60);
    }, 350);
  };
  const endHold = () => {
    window.clearTimeout(hold.current.t);
    window.clearInterval(hold.current.i);
    cancelAnimationFrame(pageRaf.current);
    pageRaf.current = 0;
    hold.current = {};
  };

  // Runs the scroll toward the pointer per frame, accelerating, until it arrives. Not
  // a timer of page jumps: each jump restarts the smooth-scroll animation, so they
  // interrupt each other and the list crawls.
  const pageFrame = () => {
    const el = targetRef.current;
    const rail = railRef.current;
    if (!el || !rail) {
      endHold();
      return;
    }
    const { trackTop: top, thumbLen: len, travel: run, overflow: range } = geom.current;
    if (range <= 0) {
      endHold();
      return;
    }
    const railTop = rail.getBoundingClientRect().top;
    const y = pagePointer.current;
    const thumbTop = railTop + top + (pageTarget.current / range) * run;
    if (y >= thumbTop && y <= thumbTop + len) {
      endHold();
      return;
    }
    // Clamping each step to the goal is what keeps acceleration from overshooting.
    const goal = Math.min(range, Math.max(0, ((y - railTop - top - len / 2) / run) * range));
    pageRate.current = Math.min(PAGE_TO, pageRate.current + PAGE_ACCEL / 60);
    const step = (pageRate.current * el.clientHeight) / 60;
    const next =
      goal > pageTarget.current
        ? Math.min(goal, pageTarget.current + step)
        : Math.max(goal, pageTarget.current - step);
    if (next === pageTarget.current) {
      endHold();
      return;
    }
    pageTarget.current = next;
    el.scrollTop = next;
    pageRaf.current = requestAnimationFrame(pageFrame);
  };

  const onTrackDown = (e: React.PointerEvent) => {
    const el = targetRef.current;
    const rail = railRef.current;
    if (!el || !rail) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    pagePointer.current = e.clientY;
    pageRate.current = PAGE_FROM;
    // A plain click stays a single smooth page; the glide only starts if it is held.
    const thumbTop =
      rail.getBoundingClientRect().top + trackTop + (el.scrollTop / overflow) * travel;
    pageTarget.current = Math.min(
      overflow,
      Math.max(0, el.scrollTop + (e.clientY < thumbTop ? -m.clientH : m.clientH))
    );
    el.scrollTo({ top: pageTarget.current, behavior: 'smooth' });
    hold.current.t = window.setTimeout(() => {
      pageRaf.current = requestAnimationFrame(pageFrame);
    }, 300);
  };
  const onTrackMove = (e: React.PointerEvent) => {
    pagePointer.current = e.clientY;
  };
  const onTrackUp = (e: React.PointerEvent) => {
    endHold();
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  const showTicks = expanded && !!sections?.length && trackLen > sections.length * 5;

  const caretSx = {
    position: 'absolute' as const,
    left: 0,
    right: 0,
    height: CARET,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    color: alpha(theme.palette.text.primary, 0.55),
    pointerEvents: 'auto' as const,
    '&:hover': { color: theme.palette.text.primary },
  };

  return createPortal(
    <Box
      ref={railRef}
      sx={{
        position: 'absolute',
        // From the scroller's right edge, not the host's: the host may be a wider
        // padded wrapper, or not the scroller's parent at all.
        left: m.offX + m.clientW - (outside ? 0 : RAIL),
        top: m.offY,
        height: m.clientH,
        width: RAIL,
        zIndex: 6,
        pointerEvents: 'none',
        opacity: shown ? 1 : 0,
        transition: 'opacity 160ms ease',
        '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
      }}
    >
      {/* A recess for the thumb, not a second bar. */}
      <Box
        sx={{
          position: 'absolute',
          inset: `${inset}px 0 ${bottomInset ?? inset}px 0`,
          borderRadius: `${RAIL / 2}px`,
          opacity: expanded ? 1 : 0,
          backgroundColor: alpha(
            theme.palette.text.primary,
            theme.palette.mode === 'dark' ? 0.07 : 0.05
          ),
          transition: 'opacity 120ms ease',
          '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
        }}
      />
      {expanded && (
        <>
          <Box
            sx={{ ...caretSx, top: inset }}
            onPointerDown={() => startHold(-1)}
            onPointerUp={endHold}
            onPointerLeave={endHold}
          >
            <ArrowDropUpRounded sx={{ fontSize: 22 }} />
          </Box>
          <Box
            sx={{ ...caretSx, bottom: bottomInset ?? inset }}
            onPointerDown={() => startHold(1)}
            onPointerUp={endHold}
            onPointerLeave={endHold}
          >
            <ArrowDropDownRounded sx={{ fontSize: 22 }} />
          </Box>
        </>
      )}

      <Box
        onPointerDown={expanded ? onTrackDown : undefined}
        onPointerMove={onTrackMove}
        onPointerUp={onTrackUp}
        onPointerCancel={onTrackUp}
        sx={{
          position: 'absolute',
          top: trackTop,
          height: trackLen,
          left: 0,
          right: 0,
          pointerEvents: expanded ? 'auto' : 'none',
        }}
      >
        {showTicks &&
          sections?.map(s => (
            <Box
              key={`${s.label}-${s.offset}`}
              sx={{
                position: 'absolute',
                right: (RAIL - 4) / 2,
                top: Math.min(trackLen, (s.offset / overflow) * travel + thumbLen / 2),
                width: 4,
                height: 2,
                borderRadius: 1,
                backgroundColor: alpha(theme.palette.text.primary, 0.4),
              }}
            />
          ))}
      </Box>

      <Box
        ref={thumbRef}
        role="scrollbar"
        aria-orientation="vertical"
        aria-valuemin={0}
        aria-valuemax={overflow}
        onPointerDown={onThumbDown}
        onPointerMove={onThumbMove}
        onPointerUp={onThumbUp}
        onPointerCancel={onThumbUp}
        sx={{
          position: 'absolute',
          top: 0,
          height: thumbLen,
          right: (RAIL - (expanded ? THUMB_FAT : THUMB_THIN)) / 2,
          width: expanded ? THUMB_FAT : THUMB_THIN,
          borderRadius: THUMB_FAT,
          backgroundColor:
            dragging || hovering
              ? theme.palette.surfaces.accent
              : alpha(theme.palette.surfaces.accent, 0.85),
          pointerEvents: expanded ? 'auto' : 'none',
          transition: 'width 120ms ease, right 120ms ease, background-color 120ms ease',
          '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
        }}
      />

      {dragging && label && (
        <Box
          ref={bubbleRef}
          sx={{
            position: 'absolute',
            top: 0,
            right: RAIL + 8,
            width: BUBBLE,
            height: BUBBLE,
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 18,
            fontWeight: 600,
            lineHeight: 1,
            color: theme.palette.primary.contrastText,
            backgroundColor: theme.palette.primary.main,
            boxShadow: theme.shadows[6],
            pointerEvents: 'none',
          }}
        >
          {label}
        </Box>
      )}
    </Box>,
    host
  );
}

export default FloatingScrollbar;
