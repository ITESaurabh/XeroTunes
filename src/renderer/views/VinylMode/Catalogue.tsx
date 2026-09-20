import React, { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useIpc } from '../../state/ipc';
import { store, Track } from '../../utils/store';
import { QUERY_KEYS } from '../../constants/queryKeys';
import { formatDuration } from '../../utils/formatDuration';
import { DEFAULT_AA } from '../../../config/constants';

// COMPACT fits the tray a narrow window keeps the catalogue in.
interface Metrics {
  card: number;
  pitch: number;
  window: number;
  /** Card plus its letter, centred in the window. */
  top: number;
}
const FULL: Metrics = { card: 176, pitch: 200, window: 290, top: (290 - 176 - 26) / 2 };
const COMPACT: Metrics = { card: 116, pitch: 134, window: 196, top: (196 - 116 - 26) / 2 };
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

// Engraved: light catches the lower edge of the cut.
const caption: React.CSSProperties = {
  font: "600 10px/1 Georgia, 'Times New Roman', serif",
  letterSpacing: 2,
  color: '#6a6b72',
  textTransform: 'uppercase',
  textShadow: '0 1px 0 rgba(255,255,255,.75)',
};

const paper: React.CSSProperties = {
  background: '#f3efe6',
  boxShadow: '0 1px 2px rgba(0,0,0,.35), 0 3px 6px rgba(0,0,0,.15)',
};

interface Album {
  key: string;
  title: string;
  artist: string;
  cover: string | null;
  tracks: Track[];
}

function coverUrl(track: Track | undefined): string | null {
  return track?.AlbumArt ? `file:///${(track.AlbumArt as string).replace(/\\/g, '/')}` : null;
}

function trackNo(t: Track): number {
  const n = parseInt(String(t.TrackNumber ?? ''), 10);
  return Number.isFinite(n) ? n : 0;
}

function groupAlbums(songs: Track[]): Album[] {
  const byKey = new Map<string, Album>();
  for (const t of songs) {
    const title = (t.AlbumTitle as string) || 'Singles';
    const key = t.AlbumId != null ? String(t.AlbumId) : `~${title}`;
    let album = byKey.get(key);
    if (!album) {
      album = { key, title, artist: (t.ArtistName as string) || '', cover: null, tracks: [] };
      byKey.set(key, album);
    }
    album.tracks.push(t);
    if (!album.cover) album.cover = coverUrl(t);
  }
  const albums = [...byKey.values()];
  for (const a of albums) a.tracks.sort((x, y) => trackNo(x) - trackNo(y));
  return albums.sort((a, b) => a.title.localeCompare(b.title, undefined, { sensitivity: 'base' }));
}

function initial(title: string): string {
  const c = title.trim().charAt(0).toUpperCase();
  return LETTERS.includes(c) ? c : '#';
}

// `offset` is cards from the centre, fractional while the row moves. The row is
// placed every frame, so nothing here eases.
function Card({
  album,
  offset,
  m,
  onPick,
}: {
  album: Album;
  offset: number;
  m: Metrics;
  onPick: () => void;
}) {
  const sel = Math.abs(offset) < 0.5;
  const dim = Math.min(0.6, Math.abs(offset) * 0.22);
  return (
    <div
      onClick={onPick}
      title={`${album.title}\n${album.artist}`}
      style={{
        position: 'absolute',
        left: '50%',
        top: m.top,
        width: m.card,
        marginLeft: -m.card / 2,
        transform: `translateX(${offset * m.pitch}px)`,
        filter: `brightness(${1 - dim})`,
        zIndex: sel ? 1 : 0,
      }}
    >
      <div
        className="vm-card"
        style={{
          width: m.card,
          height: m.card,
          borderRadius: 3,
          overflow: 'hidden',
          background: '#1c1c20',
          transform: sel ? 'translateY(-6px) scale(1.05)' : 'none',
          transition: 'transform .25s ease, box-shadow .25s ease',
          boxShadow: sel
            ? '0 0 0 2px #ff7a35, 0 14px 26px rgba(0,0,0,.7)'
            : '0 10px 20px rgba(0,0,0,.6), inset 0 0 0 1px rgba(255,255,255,.12)',
        }}
      >
        <img
          src={album.cover ?? DEFAULT_AA}
          alt=""
          draggable={false}
          style={{ display: 'block', width: '100%', height: '100%', objectFit: 'cover' }}
        />
      </div>
      <div
        style={{
          ...caption,
          marginTop: 10,
          textAlign: 'center',
          textShadow: 'none',
          color: sel ? '#ff7a35' : '#8e8f95',
        }}
      >
        {initial(album.title)}
      </div>
    </div>
  );
}

export default function Catalogue({ compact = false }: { compact?: boolean }) {
  const m = compact ? COMPACT : FULL;
  const { invokeEventToMainProcess } = useIpc();
  const { state, dispatch } = useContext(store);
  const [query, setQuery] = useState('');
  const [pos, setPos] = useState(0);
  const [selected, setSelected] = useState(0);
  const posRef = useRef(0);
  const rideRef = useRef(0);

  const { data: allSongs = [] as Track[] } = useQuery({
    queryKey: [QUERY_KEYS.ALL_SONGS],
    queryFn: () => invokeEventToMainProcess('get-all-songs', undefined) as Promise<Track[]>,
  });

  const albums = useMemo(() => groupAlbums(allSongs), [allSongs]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return albums;
    const hit = (v: unknown) => typeof v === 'string' && v.toLowerCase().includes(q);
    return albums.filter(
      a => hit(a.title) || hit(a.artist) || a.tracks.some(t => hit(t.Title) || hit(t.ArtistName))
    );
  }, [albums, query]);

  const currentId = state.track?.Id;
  const onDeckKey = useMemo(
    () => albums.find(a => a.tracks.some(t => t.Id === currentId))?.key,
    [albums, currentId]
  );

  const place = (i: number) => {
    cancelAnimationFrame(rideRef.current);
    posRef.current = i;
    setPos(i);
    setSelected(i);
  };

  // Jukebox mechanism: the row runs past everything in between, faster through
  // the middle of a long trip.
  const rideTo = (to: number) => {
    const target = Math.max(0, Math.min(shown.length - 1, to));
    cancelAnimationFrame(rideRef.current);
    const from = posRef.current;
    const dist = Math.abs(target - from);
    if (dist < 0.001) return place(target);
    const ms = Math.min(2600, 380 + dist * 45);
    const ease = (t: number) =>
      dist > 3
        ? t < 0.5
          ? 16 * t ** 5
          : 1 - (-2 * t + 2) ** 5 / 2
        : t < 0.5
          ? 4 * t ** 3
          : 1 - (-2 * t + 2) ** 3 / 2;
    const t0 = performance.now();
    const frame = (now: number) => {
      const t = Math.min(1, (now - t0) / ms);
      posRef.current = from + (target - from) * ease(t);
      setPos(posRef.current);
      if (t < 1) rideRef.current = requestAnimationFrame(frame);
      else setSelected(target);
    };
    rideRef.current = requestAnimationFrame(frame);
  };
  useEffect(() => () => cancelAnimationFrame(rideRef.current), []);

  // Straight to the record on deck; to the first card when a search leaves it nowhere else.
  useEffect(() => {
    const i = shown.findIndex(a => a.key === onDeckKey);
    place(i >= 0 ? i : 0);
  }, [shown, onDeckKey]);

  const album = shown[selected];
  const step = (d: number) => rideTo(Math.round(posRef.current) + d);
  const jumpTo = (letter: string) => {
    const i = shown.findIndex(a => initial(a.title) === letter);
    if (i >= 0) rideTo(i);
  };
  const available = useMemo(() => new Set(shown.map(a => initial(a.title))), [shown]);

  const play = (index: number) => {
    if (!album) return;
    dispatch({
      type: 'SET_QUEUE',
      payload: { queue: album.tracks, index, source: '/main_window/vinyl' },
    });
    dispatch({ type: 'SET_CURR_TRACK', payload: album.tracks[index] });
    dispatch({ type: 'SET_IS_PLAYING', payload: true });
  };

  const first = Math.max(0, Math.floor(pos) - 5);
  const window_ = shown.slice(first, Math.ceil(pos) + 6);

  // A pull under a few px is a click on the card under the pointer.
  const [pulling, setPulling] = useState(false);
  const pulledRef = useRef(false);

  // A wheel notch is a large deltaY with no deltaX and steps one card. A trackpad
  // streams small deltas: those pull the row, which settles once the fingers lift.
  const wheelIdleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onWheel = (e: React.WheelEvent) => {
    const { deltaX: dx, deltaY: dy } = e;
    if (Math.abs(dx) < 1 && Math.abs(dy) >= 40) {
      step(dy > 0 ? 1 : -1);
      return;
    }
    const d = Math.abs(dx) >= Math.abs(dy) ? dx : dy;
    cancelAnimationFrame(rideRef.current);
    posRef.current = Math.max(0, Math.min(shown.length - 1, posRef.current + d / m.pitch));
    setPos(posRef.current);
    if (wheelIdleRef.current) clearTimeout(wheelIdleRef.current);
    wheelIdleRef.current = setTimeout(() => rideTo(Math.round(posRef.current)), 120);
  };
  const grabRow = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    cancelAnimationFrame(rideRef.current);
    const x0 = e.clientX;
    const base = posRef.current;
    let dx = 0;
    pulledRef.current = false;
    setPulling(true);
    const move = (ev: PointerEvent) => {
      dx = ev.clientX - x0;
      posRef.current = Math.max(0, Math.min(shown.length - 1, base - dx / m.pitch));
      setPos(posRef.current);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setPulling(false);
      pulledRef.current = Math.abs(dx) > 4;
      rideTo(Math.round(posRef.current));
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        // In the tray the handle above already clears the window chrome.
        padding: compact ? '8px 16px 20px' : '45px 30px 40px 20px',
        boxSizing: 'border-box',
        gap: 16,
      }}
    >
      <label
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          height: 38,
          padding: '0 16px',
          borderRadius: 9,
          background: 'linear-gradient(180deg,#232327,#111113)',
          boxShadow:
            'inset 0 3px 6px rgba(0,0,0,.85), inset 0 -1px 0 rgba(255,255,255,.08), 0 1px 0 rgba(255,255,255,.75)',
        }}
      >
        <span style={{ ...caption, color: '#a4a4a5', textShadow: 'none' }}>Search</span>
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Title, artist or album"
          spellCheck={false}
          style={{
            flex: 1,
            minWidth: 0,
            background: 'none',
            border: 'none',
            outline: 'none',
            color: '#e8e9ee',
            fontSize: 15,
            caretColor: '#ff7a35',
          }}
        />
        <span style={{ ...caption, color: '#8e8f95', textShadow: 'none' }}>
          {shown.length.toLocaleString()} {shown.length === 1 ? 'album' : 'albums'}
        </span>
      </label>

      <div
        onWheel={onWheel}
        onPointerDown={grabRow}
        style={{
          position: 'relative',
          height: m.window,
          flex: 'none',
          cursor: pulling ? 'grabbing' : 'grab',
          touchAction: 'none',
          userSelect: 'none',
          borderRadius: 14,
          background: 'linear-gradient(180deg, #2a2a2e, #141416)',
          boxShadow: 'inset 0 4px 12px rgba(0,0,0,.8), 0 1px 0 rgba(255,255,255,.7)',
          overflow: 'hidden',
        }}
      >
        {window_.map((a, i) => (
          <Card
            key={a.key}
            album={a}
            offset={first + i - pos}
            m={m}
            onPick={() => {
              if (!pulledRef.current) rideTo(first + i);
            }}
          />
        ))}
        {shown.length === 0 && (
          <div
            style={{
              ...caption,
              position: 'absolute',
              inset: 0,
              display: 'grid',
              placeItems: 'center',
              color: '#8e8f95',
              textShadow: 'none',
            }}
          >
            {albums.length ? 'Nothing in the box' : 'Empty box'}
          </div>
        )}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            pointerEvents: 'none',
            background:
              'linear-gradient(180deg, rgba(255,255,255,.14), transparent 30%, transparent 75%, rgba(255,255,255,.05))',
          }}
        />
      </div>

      {album && (
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'baseline',
            gap: 16,
          }}
        >
          <div
            style={{
              font: "600 15px Georgia, 'Times New Roman', serif",
              color: '#1c1c20',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
            }}
          >
            {album.title}
            <span style={{ color: '#6a6b72', fontWeight: 400 }}> · {album.artist}</span>
          </div>
          <span style={{ ...caption, flex: 'none' }}>
            {album.key === onDeckKey ? 'On deck · ' : ''}
            {album.tracks.length} {album.tracks.length === 1 ? 'track' : 'tracks'}
          </span>
        </div>
      )}

      <div
        className="vm-tray"
        style={{
          flex: 1,
          minHeight: 0,
          borderRadius: 12,
          background: 'linear-gradient(180deg,#a3a4ab,#b9bac0)',
          boxShadow: 'inset 0 5px 12px rgba(0,0,0,.35), 0 1px 0 rgba(255,255,255,.7)',
          padding: '16px 18px',
          overflowY: 'auto',
          scrollbarGutter: 'stable',
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '10px 14px',
          alignContent: 'start',
          boxSizing: 'border-box',
        }}
      >
        {album?.tracks.map((t, i) => {
          const on = t.Id === currentId;
          return (
            <div
              key={t.Id}
              className="vm-strip"
              onClick={() => play(i)}
              title={`${t.Title}\n${t.ArtistName ?? ''}`}
              style={{
                ...paper,
                position: 'relative',
                borderRadius: 3,
                padding: on ? '8px 84px 8px 44px' : '8px 12px 8px 44px',
                font: "600 13px/1.2 Georgia, 'Times New Roman', serif",
                color: '#1c1c20',
                cursor: 'pointer',
                background: on ? 'linear-gradient(180deg,#fff1e8,#ffe3d1)' : paper.background,
                minWidth: 0,
              }}
            >
              <span
                style={{
                  position: 'absolute',
                  left: 10,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  width: 26,
                  height: 26,
                  borderRadius: 4,
                  display: 'grid',
                  placeItems: 'center',
                  font: "600 11px Georgia, 'Times New Roman', serif",
                  color: '#fff',
                  background: on
                    ? 'linear-gradient(180deg,#ff7a35,#c93f09)'
                    : 'linear-gradient(180deg,#55555c,#26262a)',
                  boxShadow: 'inset 0 1px 0 rgba(255,255,255,.2)',
                }}
              >
                {trackNo(t) || i + 1}
              </span>
              <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {(t.Title as string) || 'Untitled'}
              </div>
              <small
                style={{
                  display: 'block',
                  font: '11px system-ui, sans-serif',
                  color: '#6a6b72',
                  marginTop: 3,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {(t.ArtistName as string) || album.artist}
                {t.Duration ? ` · ${formatDuration(t.Duration)}` : ''}
              </small>
              {on && (
                <span
                  style={{
                    ...caption,
                    position: 'absolute',
                    right: 10,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    color: '#c93f09',
                    textShadow: 'none',
                  }}
                >
                  Playing
                </span>
              )}
            </div>
          );
        })}
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, justifyContent: 'center' }}>
        {LETTERS.map(l => {
          const has = available.has(l);
          return (
            <button
              key={l}
              type="button"
              className="vm-key"
              disabled={!has}
              onClick={() => jumpTo(l)}
              style={{
                width: 30,
                height: 24,
                padding: 0,
                border: 'none',
                borderRadius: 5,
                background: 'linear-gradient(180deg,#f4f4f6,#a9aab0)',
                boxShadow: has
                  ? '0 3px 6px rgba(0,0,0,.45), inset 0 1px 1px rgba(255,255,255,.8)'
                  : 'inset 0 1px 3px rgba(0,0,0,.35)',
                font: "600 11px Georgia, 'Times New Roman', serif",
                color: has ? '#1c1c20' : '#8e8f95',
                cursor: has ? 'pointer' : 'default',
              }}
            >
              {l}
            </button>
          );
        })}
      </div>
    </div>
  );
}
