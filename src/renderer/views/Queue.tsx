import React, {
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Box,
  FormControlLabel,
  IconButton,
  ListItemIcon,
  ListItemText,
  MenuItem,
  Paper,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import { Icon } from '@iconify/react';
import DragIndicatorIcon from '@mui/icons-material/DragIndicator';
import dismissIcon from '@iconify/icons-fluent/dismiss-24-regular';
import deleteIcon from '@iconify/icons-fluent/delete-24-regular';
import { motion } from 'motion/react';
import { VariableSizeList, ListChildComponentProps, areEqual } from 'react-window';
import AutoSizer from 'react-virtualized-auto-sizer';
import PageToolbar from '../components/PageToolbar';
import FloatingScrollbar from '../components/FloatingScrollbar';
import PlaybarListInner from '../components/PlaybarListInner';
import XTSwitch from '../components/XTSwitch';
import Empty from '../components/Empty';
import ArtistCell from '../components/ArtistCell';
import EqualizerBars from '../components/EqualizerBars';
import { useTrackMenu } from '../components/TrackContextMenu';
import { store, QueueTrack, Track } from '../utils/store';
import { toMediaSrc } from '../utils/misc';
import { useScrollHidePlayerBar } from '../utils/useScrollHidePlayerBar';
import { getQueueShowPlayed, setQueueShowPlayed } from '../utils/LocStoreUtil';
import { listRowSx } from '../styles/listSx';
import { DEFAULT_AA } from '../../config/constants';

const ROW_H = 56;
const HEADER_H = 32;
// Auto-scroll zone at the list's top and bottom while dragging, so a finger can go further.
const EDGE = 56;
// How much of the next song a bottom pin shows above the bar: its cover and title.
const PIN_PEEK = ROW_H / 2;

type Section = 'played' | 'now' | 'queued' | 'list';
type Row =
  | { kind: 'header'; label: string }
  | { kind: 'empty' }
  | { kind: 'entry'; track: QueueTrack; section: Section };

const songs = (n: number) => `${n} song${n === 1 ? '' : 's'}`;
const rowHeight = (row: Row | undefined) => (row?.kind === 'header' ? HEADER_H : ROW_H);

function buildRows(queue: QueueTrack[], queueIndex: number, showPlayed: boolean): Row[] {
  const current = queue[queueIndex];
  if (!current) return [];
  const rows: Row[] = [];
  const section = (s: Section, label: string, from: number, to: number) => {
    if (to <= from) return;
    rows.push({ kind: 'header', label: `${label} · ${songs(to - from)}` });
    for (let i = from; i < to; i++) rows.push({ kind: 'entry', track: queue[i], section: s });
  };
  if (showPlayed) section('played', 'Played', 0, queueIndex);
  rows.push(
    { kind: 'header', label: 'Now playing' },
    { kind: 'entry', track: current, section: 'now' }
  );
  if (queueIndex + 1 >= queue.length) {
    rows.push({ kind: 'header', label: 'Up next' }, { kind: 'empty' });
    return rows;
  }
  for (let i = queueIndex + 1; i < queue.length; ) {
    const queued = !!queue[i].Queued;
    let end = i;
    while (end < queue.length && !!queue[end].Queued === queued) end++;
    if (!queued) section('list', 'Next from the list', i, end);
    else section('queued', i === queueIndex + 1 ? 'Playing next' : 'Added to queue', i, end);
    i = end;
  }
  return rows;
}

function SectionHeader({ label, style }: { label: string; style?: React.CSSProperties }) {
  return (
    <Box
      style={style}
      sx={{ height: HEADER_H, display: 'flex', alignItems: 'flex-end', px: 1, pb: 1 }}
    >
      <Typography variant="body2" sx={{ color: 'text.secondary', fontWeight: 600 }}>
        {label}
      </Typography>
    </Box>
  );
}

interface RowProps {
  track: QueueTrack;
  index: number;
  style?: React.CSSProperties;
  isCurrent?: boolean;
  isPlaying?: boolean;
  dimmed?: boolean;
  onPlay?: () => void;
  onContextMenu?: (_e: React.MouseEvent, _song: Track) => void;
  children?: React.ReactNode;
}

function QueueRow({
  track,
  index,
  style,
  isCurrent = false,
  isPlaying = false,
  dimmed = false,
  onPlay,
  onContextMenu,
  children,
}: RowProps) {
  return (
    <Box
      style={style}
      onClick={onPlay}
      onContextMenu={onContextMenu && (e => onContextMenu(e, track))}
      sx={{
        height: ROW_H,
        gap: 1.5,
        pl: 1,
        cursor: onPlay ? 'pointer' : 'default',
        ...listRowSx(index),
        ...(isCurrent ? { bgcolor: 'surfaces.selection' } : {}),
        ...(dimmed && { opacity: 0.5 }),
      }}
    >
      <Box
        component="img"
        src={track.AlbumArt ? toMediaSrc(track.AlbumArt) : DEFAULT_AA}
        alt=""
        loading="lazy"
        decoding="async"
        draggable={false}
        sx={{ width: 40, height: 40, borderRadius: 1, objectFit: 'cover', flexShrink: 0 }}
      />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography
          variant="body2"
          noWrap
          sx={{
            fontWeight: isCurrent ? 700 : 400,
            color: isCurrent ? 'primary.main' : 'text.primary',
          }}
        >
          {track.Title || 'Unknown'}
        </Typography>
        <ArtistCell artistNameRaw={track.ArtistName} variant="caption" />
      </Box>
      {isCurrent && (
        <Box sx={{ color: 'primary.main', display: 'flex', pr: 2 }}>
          <EqualizerBars playing={isPlaying} height={14} barWidth={4} barCount={4} />
        </Box>
      )}
      {children}
    </Box>
  );
}

const hitSx = { width: 44, height: 44, flexShrink: 0 };
const handleSx = {
  ...hitSx,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: 'text.disabled',
  cursor: 'grab',
  // Without this a touch on the handle scrolls the list instead of dragging.
  touchAction: 'none',
};

interface ListData {
  rows: Row[];
  isPlaying: boolean;
  drag: { from: number; to: number } | null;
  onPlay: (_t: QueueTrack) => void;
  onRemove: (_t: QueueTrack) => void;
  onContextMenu: (_e: React.MouseEvent, _song: Track) => void;
  onDragStart: (_e: React.PointerEvent, _index: number) => void;
}

const ListRow = React.memo(function ListRow({
  index,
  style,
  data,
}: ListChildComponentProps<ListData>) {
  const row = data.rows[index];
  if (row.kind === 'header') return <SectionHeader label={row.label} style={style} />;
  if (row.kind === 'empty') {
    return (
      <Typography style={style} variant="body2" sx={{ px: 1, color: 'text.disabled' }}>
        Nothing after this song. Use “Play next” or “Add to queue” from any song’s menu.
      </Typography>
    );
  }

  // Rows between the dragged song's slot and where it would land slide over by one.
  const { drag } = data;
  let rowStyle = style;
  if (drag) {
    let shift = 0;
    if (drag.from < index && index <= drag.to) shift = -ROW_H;
    else if (drag.to <= index && index < drag.from) shift = ROW_H;
    rowStyle = {
      ...style,
      transform: shift ? `translateY(${shift}px)` : undefined,
      transition: 'transform 150ms ease',
      visibility: index === drag.from ? 'hidden' : undefined,
    };
  }

  const { track } = row;
  const now = row.section === 'now';
  const played = row.section === 'played';
  return (
    <QueueRow
      style={rowStyle}
      track={track}
      index={index}
      isCurrent={now}
      isPlaying={data.isPlaying}
      dimmed={played}
      onPlay={now ? undefined : () => data.onPlay(track)}
      onContextMenu={data.onContextMenu}
    >
      {!now && (
        <>
          {/* Played songs only go back in by playing them; the spacer keeps ✕ aligned. */}
          {played ? (
            <Box sx={hitSx} />
          ) : (
            <Box
              aria-label="drag to reorder"
              onPointerDown={e => data.onDragStart(e, index)}
              onClick={e => e.stopPropagation()}
              sx={handleSx}
            >
              <DragIndicatorIcon />
            </Box>
          )}
          <IconButton
            aria-label="remove from queue"
            title="Remove from queue"
            onClick={e => {
              e.stopPropagation();
              data.onRemove(track);
            }}
            sx={{ ...hitSx, color: 'text.secondary', '&:hover': { color: 'error.main' } }}
          >
            <Icon icon={dismissIcon} width={18} />
          </IconButton>
        </>
      )}
    </QueueRow>
  );
}, areEqual);

const noDrag = () => undefined;

const Queue: React.FC = () => {
  const { state, dispatch } = useContext(store);
  const scrollHide = useScrollHidePlayerBar();
  const listRef = useRef<VariableSizeList | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);

  const { queue, queueIndex } = state;
  const current = queue[queueIndex] ?? null;
  const upNextTotal = Math.max(0, queue.length - queueIndex - 1);
  const [showPlayed, setShowPlayed] = useState(getQueueShowPlayed);
  const rows = useMemo(
    () => buildRows(queue, queueIndex, showPlayed),
    [queue, queueIndex, showPlayed]
  );
  // The "Now playing" header's row; the played header and songs sit above it.
  const nowHeader = showPlayed && queueIndex > 0 ? queueIndex + 1 : 0;
  // offsets[i] is where row i starts; the last entry is the list's full height.
  const offsets = useMemo(() => {
    const out = [0];
    for (const r of rows) out.push(out[out.length - 1] + rowHeight(r));
    return out;
  }, [rows]);
  const getItemSize = useCallback((i: number) => rowHeight(rows[i]), [rows]);
  // VariableSizeList caches sizes by index and a song change moves the headers; reset
  // before paint or the rows draw a frame at the old heights.
  useLayoutEffect(() => listRef.current?.resetAfterIndex(0), [rows]);

  // Played rows come and go above the view; shift the scroll so what's on screen stays put.
  const scrolledFor = useRef(showPlayed);
  useLayoutEffect(() => {
    if (scrolledFor.current === showPlayed) return;
    scrolledFor.current = showPlayed;
    const el = scrollerRef.current;
    if (!el || queueIndex === 0) return;
    const playedH = HEADER_H + queueIndex * ROW_H;
    listRef.current?.scrollTo(el.scrollTop + (showPlayed ? playedH : -playedH));
  }, [showPlayed, queueIndex]);

  const togglePlayed = useCallback((on: boolean) => {
    setShowPlayed(on);
    setQueueShowPlayed(on);
  }, []);

  // "Now playing" pins to the top edge once scrolled past, and to the bottom edge when
  // scrolled back into played songs.
  const barTop = state.isPlayerBarVisible ? state.playBarInset : 0;
  const bottomInsetRef = useRef(barTop);
  bottomInsetRef.current = barTop;
  const [pin, setPin] = useState<'top' | 'bottom' | null>(null);
  // "Now playing", its song, then the next section's header: always three rows.
  const pinBlockH = (offsets[nowHeader + 3] ?? 0) - offsets[nowHeader] + PIN_PEEK;
  const updatePin = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const top = offsets[nowHeader] - el.scrollTop;
    const visibleBottom = el.clientHeight - barTop;
    if (top < 0) setPin('top');
    else setPin(top + pinBlockH > visibleBottom ? 'bottom' : null);
  }, [offsets, nowHeader, pinBlockH, barTop]);
  useLayoutEffect(updatePin, [updatePin]);
  const handleScroll = useCallback(
    (args: { scrollOffset: number }) => {
      scrollHide(args);
      updatePin();
    },
    [scrollHide, updatePin]
  );
  const showNow = useCallback(
    () => listRef.current?.scrollToItem(nowHeader, 'start'),
    [nowHeader]
  );

  const [drag, setDrag] = useState<{ from: number; to: number; top: number } | null>(null);
  const endDrag = useRef<(() => void) | null>(null);
  // A song ending mid-drag moves every row under the finger, so the drag is dropped.
  useEffect(() => () => endDrag.current?.(), [queue, queueIndex]);
  // Releasing a drag over a row fires that row's click, which would play it.
  const justDropped = useRef(false);

  const playEntry = useCallback(
    (t: QueueTrack) => {
      if (justDropped.current) return;
      const i = queue.indexOf(t);
      if (i >= 0) dispatch({ type: 'PLAY_QUEUE_INDEX', payload: i });
    },
    [queue, dispatch]
  );

  const removeEntry = useCallback(
    (t: QueueTrack) => {
      const i = queue.indexOf(t);
      if (i >= 0) dispatch({ type: 'REMOVE_FROM_QUEUE', payload: i });
    },
    [queue, dispatch]
  );

  const startDrag = useCallback(
    (e: React.PointerEvent, from: number) => {
      const scroller = scrollerRef.current;
      const row = rows[from];
      if (!scroller || row?.kind !== 'entry' || endDrag.current) return;
      e.preventDefault();

      const inSection = (i: number) => {
        const r = rows[i];
        return r?.kind === 'entry' && r.section === row.section;
      };
      let lo = from;
      while (inSection(lo - 1)) lo--;
      let hi = from;
      while (inSection(hi + 1)) hi++;

      const startTop = offsets[from] - scroller.scrollTop;
      const grab = e.clientY - scroller.getBoundingClientRect().top - startTop;
      let y = e.clientY;
      let to = from;
      let frame = 0;

      const tick = () => {
        const box = scroller.getBoundingClientRect();
        // The player bar covers the bottom of the list, so the edge is where it starts.
        const bottom = box.bottom - bottomInsetRef.current;
        if (y < box.top + EDGE) scroller.scrollTop -= Math.ceil((box.top + EDGE - y) / 4);
        else if (y > bottom - EDGE) scroller.scrollTop += Math.ceil((y - bottom + EDGE) / 4);
        const top = Math.min(bottom - box.top - ROW_H, Math.max(0, y - box.top - grab));
        if (overlayRef.current) overlayRef.current.style.top = `${top}px`;
        // The section is all song rows, so it counts in whole rows from its first one.
        const slot = Math.floor((top + scroller.scrollTop + ROW_H / 2 - offsets[lo]) / ROW_H);
        const next = Math.min(hi, Math.max(lo, lo + slot));
        if (next !== to) {
          to = next;
          setDrag(d => d && { ...d, to: next });
        }
        frame = requestAnimationFrame(tick);
      };
      const onMove = (ev: PointerEvent) => {
        y = ev.clientY;
      };
      const end = () => {
        cancelAnimationFrame(frame);
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', end);
        endDrag.current = null;
        setDrag(null);
      };
      const onUp = () => {
        end();
        justDropped.current = true;
        setTimeout(() => (justDropped.current = false), 0);
        const target = rows[to];
        if (to === from || target?.kind !== 'entry') return;
        const next = queue.slice();
        next.splice(queue.indexOf(row.track), 1);
        next.splice(queue.indexOf(target.track), 0, row.track);
        dispatch({ type: 'REORDER_QUEUE', payload: next });
      };

      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
      window.addEventListener('pointercancel', end);
      endDrag.current = end;
      setDrag({ from, to: from, top: startTop });
      frame = requestAnimationFrame(tick);
    },
    [rows, offsets, queue, dispatch]
  );

  const { openTrackMenu, trackMenu } = useTrackMenu(
    useCallback(
      (song: Track, close: () => void) =>
        song === current ? null : (
          <MenuItem
            onClick={() => {
              close();
              removeEntry(song as QueueTrack);
            }}
          >
            <ListItemIcon>
              <Icon icon={dismissIcon} width={20} />
            </ListItemIcon>
            <ListItemText>Remove from queue</ListItemText>
          </MenuItem>
        ),
      [current, removeEntry]
    )
  );

  const itemData = useMemo<ListData>(
    () => ({
      rows,
      isPlaying: state.isPlaying,
      drag: drag && { from: drag.from, to: drag.to },
      onPlay: playEntry,
      onRemove: removeEntry,
      onContextMenu: openTrackMenu,
      onDragStart: startDrag,
    }),
    [rows, state.isPlaying, drag, playEntry, removeEntry, openTrackMenu, startDrag]
  );

  // The rows frozen under a bottom pin can't be dragged: they aren't where the list has them.
  const frozenData = useMemo<ListData>(
    () => ({ ...itemData, drag: null, onDragStart: noDrag }),
    [itemData]
  );
  // A bottom pin runs from its header to the page bottom, behind and under the bar, like
  // the list it stands in for.
  const pinHeight = pinBlockH + barTop;
  const frozen: number[] = [];
  if (pin === 'bottom') {
    for (let i = nowHeader + 2; i < rows.length && offsets[i] - offsets[nowHeader] < pinHeight; i++) {
      frozen.push(i);
    }
  }

  const dragged = drag ? rows[drag.from] : null;

  return (
    <Box
      component={motion.div}
      initial={{ y: 20, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: -20, opacity: 0 }}
      transition={{ duration: 0.3 }}
      sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}
    >
      <PageToolbar
        title="Queue"
        action={
          <Stack direction="row" spacing={2} alignItems="center">
            {/* MUI's -11px offset assumes a padded switch; XTSwitch has none. */}
            <FormControlLabel
              labelPlacement="start"
              sx={{ m: 0, gap: 1.5 }}
              control={
                <XTSwitch checked={showPlayed} onChange={e => togglePlayed(e.target.checked)} />
              }
              label={<Typography variant="body2">Show played</Typography>}
            />
            {/* The span keeps the tooltip working while the button is disabled. */}
            <Tooltip title="Clear queue">
              <span>
                <IconButton
                  aria-label="Clear queue"
                  disabled={upNextTotal === 0}
                  onClick={() => dispatch({ type: 'CLEAR_UP_NEXT' })}
                >
                  <Icon icon={deleteIcon} width={24} />
                </IconButton>
              </span>
            </Tooltip>
          </Stack>
        }
      />

      {!current ? (
        <Empty page="Queue" hint="Play something and it lines up here." />
      ) : (
        <Box
          sx={{
            flex: 1,
            minHeight: 0,
            // No bottom margin: the list and a bottom pin run to the page edge under the bar.
            mx: 1,
            mt: 1,
            position: 'relative',
            ...(drag && { userSelect: 'none', cursor: 'grabbing' }),
          }}
        >
          <FloatingScrollbar targetRef={scrollerRef} />
          <AutoSizer>
            {({ height, width }: { height: number; width: number }) => (
              <VariableSizeList
                ref={listRef}
                outerRef={scrollerRef}
                innerElementType={PlaybarListInner}
                height={height}
                width={width}
                itemCount={rows.length}
                itemSize={getItemSize}
                estimatedItemSize={ROW_H}
                itemData={itemData}
                initialScrollOffset={offsets[nowHeader]}
                overscanCount={10}
                onScroll={handleScroll}
              >
                {ListRow}
              </VariableSizeList>
            )}
          </AutoSizer>
          {pin && (
            // Paper, to match the page surface including its dark-mode overlay.
            <Paper
              square
              sx={{
                position: 'absolute',
                left: 0,
                right: 0,
                zIndex: 1,
                overflow: 'hidden',
                // Shadow only on the side the rows scroll past, not along the page edge.
                ...(pin === 'top'
                  ? { top: 0, boxShadow: '0 4px 6px -4px rgba(0, 0, 0, 0.4)' }
                  : {
                      bottom: 0,
                      height: pinHeight,
                      boxShadow: '0 -4px 6px -4px rgba(0, 0, 0, 0.4)',
                    }),
              }}
            >
              <SectionHeader label="Now playing" />
              <QueueRow
                track={current}
                index={nowHeader + 1}
                isCurrent
                isPlaying={state.isPlaying}
                onPlay={showNow}
                onContextMenu={openTrackMenu}
              />
              {frozen.map(i => (
                <ListRow
                  key={i}
                  index={i}
                  style={{ height: rowHeight(rows[i]) }}
                  data={frozenData}
                />
              ))}
            </Paper>
          )}
          {drag && dragged?.kind === 'entry' && (
            <Box
              ref={overlayRef}
              style={{ top: drag.top }}
              sx={{
                position: 'absolute',
                left: 0,
                right: 0,
                height: ROW_H,
                zIndex: 2,
                pointerEvents: 'none',
                bgcolor: 'background.paper',
                borderRadius: 1,
                boxShadow: 6,
              }}
            >
              <QueueRow track={dragged.track} index={0}>
                <Box sx={handleSx}>
                  <DragIndicatorIcon />
                </Box>
                <Box sx={hitSx} />
              </QueueRow>
            </Box>
          )}
        </Box>
      )}

      {trackMenu}
    </Box>
  );
};

export default Queue;
