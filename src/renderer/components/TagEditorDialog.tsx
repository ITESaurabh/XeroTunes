import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Checkbox,
  CircularProgress,
  Divider,
  FormControlLabel,
  IconButton,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { Icon } from '@iconify/react';
import dismiss24Regular from '@iconify/icons-fluent/dismiss-24-regular';
import image24Regular from '@iconify/icons-fluent/image-24-regular';
import delete24Regular from '@iconify/icons-fluent/delete-24-regular';
import mic24Regular from '@iconify/icons-fluent/mic-24-regular';
import info24Regular from '@iconify/icons-fluent/info-24-regular';
import { parseFile, ICommonTagsResult } from 'music-metadata';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import AppDialog from './AppDialog';
import SongInfoDialog from './SongInfoDialog';
import { useIpc } from '../state/ipc';
import { QUERY_KEYS } from '../constants/queryKeys';
import { DEFAULT_AA, isTaggable } from '../../config/constants';

export interface EditableTrack {
  Id: number | string;
  Uri: string;
  Title?: string;
}

interface TagEditorDialogProps {
  open: boolean;
  onClose: () => void;
  /** Album mode edits every track at once and only exposes album-level fields. */
  mode: 'track' | 'album';
  tracks: EditableTrack[];
}

type FieldKey =
  | 'title'
  | 'artists'
  | 'album'
  | 'albumArtists'
  | 'year'
  | 'genres'
  | 'disc'
  | 'track'
  | 'comment'
  | 'encodedBy';

interface FieldDef {
  label: string;
  numeric?: boolean;
  multiline?: boolean;
  wide?: boolean;
}

const FIELDS: Record<FieldKey, FieldDef> = {
  title: { label: 'Title', wide: true },
  artists: { label: 'Artist(s)', wide: true },
  album: { label: 'Album', wide: true },
  albumArtists: { label: 'Album Artist', wide: true },
  year: { label: 'Year', numeric: true },
  genres: { label: 'Genre' },
  disc: { label: 'Disc No.', numeric: true },
  track: { label: 'Track No.', numeric: true },
  comment: { label: 'Comment', multiline: true, wide: true },
  encodedBy: { label: 'Encoder', wide: true },
};

const TRACK_FIELDS: FieldKey[] = [
  'title',
  'artists',
  'album',
  'albumArtists',
  'year',
  'genres',
  'disc',
  'track',
  'comment',
  'encodedBy',
];

// Only tags that mean the same thing for every track on the record; title and
// track number are per-track and stay out.
const ALBUM_FIELDS: FieldKey[] = [
  'album',
  'albumArtists',
  'year',
  'genres',
  'disc',
  'comment',
  'encodedBy',
];

type Values = Record<FieldKey, string>;

const EMPTY_VALUES: Values = {
  title: '',
  artists: '',
  album: '',
  albumArtists: '',
  year: '',
  genres: '',
  disc: '',
  track: '',
  comment: '',
  encodedBy: '',
};

const ALL_KEYS = Object.keys(EMPTY_VALUES) as FieldKey[];

// XeroTunes stores the artist tag verbatim and splits it with the separators
// from Settings, so the editor also treats it as one free-text field.
function readValues(common: ICommonTagsResult): Values {
  return {
    title: common.title ?? '',
    artists: common.artist ?? (common.artists ?? []).join(', '),
    album: common.album ?? '',
    albumArtists: common.albumartist ?? '',
    year: common.year != null ? String(common.year) : '',
    genres: (common.genre ?? []).join(', '),
    disc: common.disk?.no != null ? String(common.disk.no) : '',
    track: common.track?.no != null ? String(common.track.no) : '',
    comment: (common.comment ?? [])
      .map(c => (typeof c === 'string' ? c : c.text))
      .filter(Boolean)
      .join('; '),
    encodedBy: common.encodedby ?? '',
  };
}

// Only JPEG and PNG are readable everywhere: Windows Explorer, Windows Media
// Player and most hardware players show nothing for a webp or bmp cover. The art
// picker enforces that for a chosen file, but a cover copied out of another
// track never passes through it, so it is re-encoded here.
async function toPortableImage(
  data: Uint8Array,
  format: string
): Promise<{ data: Uint8Array; ext: string }> {
  const mime = format.toLowerCase();
  if (mime === 'image/jpeg' || mime === 'image/jpg') return { data, ext: 'jpg' };
  if (mime === 'image/png') return { data, ext: 'png' };

  const bitmap = await createImageBitmap(new Blob([data as unknown as BlobPart], { type: mime }));
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not convert the cover to PNG');
    ctx.drawImage(bitmap, 0, 0);
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    return { data: new Uint8Array(await blob.arrayBuffer()), ext: 'png' };
  } finally {
    bitmap.close();
  }
}

const KEEP = { keep: true } as const;
type Choice = string | typeof KEEP;

interface TagFieldProps {
  def: FieldDef;
  value: string;
  /** Distinct values the selected files carry; a single one means no dropdown. */
  options: string[];
  /** Values from elsewhere in the library, offered even when nothing is mixed. */
  suggestions?: string[];
  mixed: boolean;
  touched: boolean;
  disabled: boolean;
  onChange: (value: string) => void;
  onKeep: () => void;
}

// mp3tag's combo box: free text, with the values already on disk one click away
// when the selected files disagree.
function TagField({
  def,
  value,
  options,
  suggestions,
  mixed,
  touched,
  disabled,
  onChange,
  onKeep,
}: TagFieldProps) {
  const own = mixed ? options : [];
  const choices: Choice[] = [
    ...(mixed ? [KEEP] : []),
    ...own,
    ...(suggestions ?? []).filter(s => s && !own.includes(s)),
  ];
  const hint = value === '' ? (touched ? '<empty>' : mixed ? '<keep>' : undefined) : undefined;
  return (
    <Autocomplete<Choice, false, true, true>
      freeSolo
      disableClearable
      openOnFocus
      selectOnFocus
      handleHomeEndKeys
      disabled={disabled}
      options={choices}
      forcePopupIcon={choices.length > 0}
      inputValue={value}
      onInputChange={(_, v, reason) => {
        if (reason === 'input') onChange(def.numeric ? v.replace(/\D/g, '') : v);
      }}
      onChange={(_, picked) => {
        if (typeof picked === 'string') onChange(picked);
        else if (picked) onKeep();
      }}
      getOptionLabel={o => (typeof o === 'string' ? o : '')}
      renderOption={(props, o) => (
        <Box component="li" {...props} key={typeof o === 'string' ? o : '__keep'}>
          {typeof o !== 'string' ? (
            <em>Keep existing</em>
          ) : o ? (
            <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              {/* Only lyrics-sized values get cut; ordinary tags are shown whole. */}
              {o.length > 300 ? `${o.slice(0, 300)}…` : o}
            </Typography>
          ) : (
            <em>(empty)</em>
          )}
        </Box>
      )}
      renderInput={params => (
        <TextField
          {...params}
          label={def.label}
          size="small"
          fullWidth
          multiline={def.multiline}
          minRows={def.multiline ? 2 : undefined}
          type={def.numeric ? 'number' : 'text'}
          inputProps={{ ...params.inputProps, ...(def.numeric ? { min: 0 } : {}) }}
          placeholder={hint}
          InputLabelProps={{ ...params.InputLabelProps, ...(hint ? { shrink: true } : {}) }}
        />
      )}
      sx={{ gridColumn: def.wide ? { sm: 'span 2' } : undefined }}
    />
  );
}

export default function TagEditorDialog({ open, onClose, mode, tracks }: TagEditorDialogProps) {
  const { invokeEventToMainProcess } = useIpc();
  const queryClient = useQueryClient();

  const { data: libraryGenres } = useQuery({
    queryKey: [QUERY_KEYS.ALL_GENRES],
    queryFn: () =>
      invokeEventToMainProcess('get-all-genres', undefined) as Promise<{ Name: string }[]>,
    enabled: open,
  });
  const genreNames = useMemo(() => (libraryGenres ?? []).map(g => g.Name), [libraryGenres]);

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [values, setValues] = useState<Values>(EMPTY_VALUES);
  const [mixed, setMixed] = useState<Set<FieldKey>>(new Set());
  const [touched, setTouched] = useState<Set<FieldKey>>(new Set());
  // Index-aligned with `tracks`; null where the file could not be parsed.
  const [perTrack, setPerTrack] = useState<(Values | null)[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string | number>>(new Set());
  const [infoTrack, setInfoTrack] = useState<EditableTrack | null>(null);
  // undefined = untouched, null = strip the art, string = path to a new image.
  const [artPath, setArtPath] = useState<string | null | undefined>(undefined);
  const [artPreview, setArtPreview] = useState<string | null>(null);
  // Art can outrun the selection: a cover is usually meant for the whole record
  // even when only a few tracks need their text tags fixed.
  const [artAll, setArtAll] = useState(false);
  // Which tracks already carry a cover, index-aligned with `tracks`, plus the
  // first one found, which is the source when copying it across the album.
  const [hasArt, setHasArt] = useState<boolean[]>([]);
  const [artSource, setArtSource] = useState<{ data: Uint8Array; format: string } | null>(null);

  const fieldKeys = mode === 'album' ? ALBUM_FIELDS : TRACK_FIELDS;

  // The derive effect below must not clobber fields the user has already typed
  // in, but re-running it on every keystroke would.
  const touchedRef = useRef(touched);
  touchedRef.current = touched;

  useEffect(() => {
    if (!open || !tracks.length) return;
    let cancelled = false;
    const objectUrls: string[] = [];

    setLoading(true);
    setError(null);
    setTouched(new Set());
    setPerTrack([]);
    setSelectedIds(new Set(tracks.filter(t => isTaggable(t.Uri)).map(t => t.Id)));
    setArtPath(undefined);
    setArtPreview(null);
    setArtAll(false);
    setHasArt([]);
    setArtSource(null);

    (async () => {
      // Covers are read for every track, not just the first: an album where only
      // the flac carries art must not look like the whole record has one.
      const metas = await Promise.all(tracks.map(t => parseFile(t.Uri).catch(() => null)));
      if (cancelled) return;

      const parsed = metas.filter(m => m !== null) as NonNullable<(typeof metas)[number]>[];
      if (!parsed.length) {
        setError('Could not read tags from these files.');
        setValues(EMPTY_VALUES);
        setLoading(false);
        return;
      }

      setPerTrack(metas.map(m => (m ? readValues(m.common) : null)));

      setHasArt(metas.map(m => !!m?.common.picture?.length));

      const picture = metas.find(m => m?.common.picture?.[0])?.common.picture?.[0];
      if (picture) {
        setArtSource({ data: picture.data, format: picture.format });
        const url = URL.createObjectURL(
          new Blob([picture.data as unknown as BlobPart], { type: picture.format })
        );
        objectUrls.push(url);
        setArtPreview(url);
      }
      setLoading(false);
    })().catch(err => {
      if (cancelled) return;
      setError(err instanceof Error ? err.message : String(err));
      setLoading(false);
    });

    return () => {
      cancelled = true;
      objectUrls.forEach(URL.revokeObjectURL);
    };
  }, [open, tracks]);

  // Shown values follow the selection: deselect the odd track out and a field
  // stops reading "multiple values". Anything still disagreeing is shown blank,
  // so saving without editing it can't flatten every track to one value.
  const selectedValues = useMemo(
    () => perTrack.filter((v, i) => v && selectedIds.has(tracks[i].Id)) as Values[],
    [perTrack, selectedIds, tracks]
  );

  useEffect(() => {
    if (!selectedValues.length) return;
    const base = selectedValues[0];
    const differing = new Set<FieldKey>(
      ALL_KEYS.filter(k => selectedValues.some(v => v[k] !== base[k]))
    );
    setMixed(differing);
    setValues(
      prev =>
        Object.fromEntries(
          ALL_KEYS.map(k => [
            k,
            touchedRef.current.has(k) ? prev[k] : differing.has(k) ? '' : base[k],
          ])
        ) as Values
    );
  }, [selectedValues]);

  const choices = useMemo(
    () =>
      Object.fromEntries(
        ALL_KEYS.map(k => [k, [...new Set(selectedValues.map(v => v[k]))]])
      ) as Record<FieldKey, string[]>,
    [selectedValues]
  );

  const setField = useCallback((key: FieldKey, value: string) => {
    setValues(prev => ({ ...prev, [key]: value }));
    setTouched(prev => (prev.has(key) ? prev : new Set(prev).add(key)));
  }, []);

  // Back to "leave it alone": untouched fields are never written.
  const keepField = useCallback(
    (key: FieldKey) => {
      setTouched(prev => {
        if (!prev.has(key)) return prev;
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
      setValues(prev => ({
        ...prev,
        [key]: mixed.has(key) ? '' : (selectedValues[0]?.[key] ?? ''),
      }));
    },
    [mixed, selectedValues]
  );

  const toggleTrack = useCallback((id: string | number) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }, []);

  const taggableTracks = useMemo(() => tracks.filter(t => isTaggable(t.Uri)), [tracks]);

  const toggleAll = useCallback(() => {
    setSelectedIds(prev =>
      prev.size === taggableTracks.length ? new Set() : new Set(taggableTracks.map(t => t.Id))
    );
  }, [taggableTracks]);

  const handlePickArt = useCallback(async () => {
    const res = (await invokeEventToMainProcess('pick-image-file')) as {
      canceled: boolean;
      filePath?: string;
    };
    if (res.canceled || !res.filePath) return;
    setArtPath(res.filePath);
    setArtPreview(`file:///${res.filePath.replace(/\\/g, '/')}`);
  }, [invokeEventToMainProcess]);

  const handleRemoveArt = useCallback(() => {
    setArtPath(null);
    setArtPreview(null);
  }, []);

  const selectedTracks = useMemo(
    () => tracks.filter(t => selectedIds.has(t.Id)),
    [tracks, selectedIds]
  );

  const untaggable = tracks.length - taggableTracks.length;
  const nothingWritable = tracks.length > 0 && !taggableTracks.length;

  const artCount = hasArt.filter(Boolean).length;
  // Named as a count of files, not a scope: 'all 7' next to six unchecked rows
  // reads as a contradiction, and non-taggable files never receive it anyway.
  const artTargets = (artAll ? tracks : selectedTracks).filter(t => isTaggable(t.Uri)).length;
  // Nothing was picked, but the album's own cover can still be pushed onto the
  // tracks that are missing it.
  const copyingArt = artAll && artPath === undefined && !!artSource;
  const artChanging = artPath !== undefined || copyingArt;
  const getsArt = (t: EditableTrack) =>
    artChanging && (artAll || selectedIds.has(t.Id)) && isTaggable(t.Uri);

  const isDirty = touched.size > 0 || artPath !== undefined || copyingArt;

  const handleSave = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      // Only what the user actually edited travels to disk; an album edit must not
      // stamp the first track's values onto every other track.
      const fields: Record<string, unknown> = {};
      for (const key of fieldKeys) {
        if (!touched.has(key)) continue;
        const raw = values[key].trim();
        if (key === 'artists' || key === 'albumArtists' || key === 'genres') {
          fields[key] = raw ? [raw] : [];
        } else if (FIELDS[key].numeric) {
          fields[key] = raw ? Number(raw) : null;
        } else {
          fields[key] = raw;
        }
      }
      // The writer takes a path, so copying the album's embedded cover means
      // spilling it to a temp file first.
      let effectiveArt = artPath;
      if (copyingArt && artSource) {
        const os = window.require('os') as typeof import('os');
        const nodeFs = window.require('fs') as typeof import('fs');
        const nodePath = window.require('path') as typeof import('path');
        const { data, ext } = await toPortableImage(artSource.data, artSource.format);
        effectiveArt = nodePath.join(os.tmpdir(), `xerotunes-cover-${Date.now()}.${ext}`);
        nodeFs.writeFileSync(effectiveArt, data);
      }
      if (effectiveArt !== undefined) fields.artPath = effectiveArt;

      // Formats with no writer never reach the main process: the warning above
      // already told the user they are skipped, so counting them as failures
      // would contradict it.
      const writable = (list: EditableTrack[]) =>
        list.filter(t => isTaggable(t.Uri)).map(t => t.Id);

      // One call, never two: only one scan worker runs at a time, so a second call
      // would silently skip its re-index and leave those tracks pointing at a
      // cleared art cache.
      const res = (await invokeEventToMainProcess('write-track-tags', {
        trackIds: writable(selectedTracks),
        artOnlyTrackIds:
          artAll && effectiveArt !== undefined
            ? writable(tracks.filter(t => !selectedIds.has(t.Id)))
            : [],
        fields,
      })) as {
        success: boolean;
        error?: string;
        failed?: { uri: string; error: string }[];
        reindexed?: boolean;
      };

      if (!res.success) {
        setError(
          res.error || res.failed?.map(f => `${f.uri}: ${f.error}`).join('\n') || 'Save failed'
        );
        setSaving(false);
        return;
      }
      if (res.reindexed === false) {
        setError(
          'Tags were written, but the library is busy scanning — covers may look stale until it finishes.'
        );
        setSaving(false);
        return;
      }
      await queryClient.invalidateQueries();
      setSaving(false);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  }, [
    fieldKeys,
    touched,
    values,
    artPath,
    artAll,
    artSource,
    copyingArt,
    tracks,
    selectedIds,
    selectedTracks,
    invokeEventToMainProcess,
    queryClient,
    onClose,
  ]);

  const busy = loading || saving;

  return (
    <AppDialog
      open={open}
      onClose={busy ? () => undefined : onClose}
      title={mode === 'album' ? 'Edit Album Tags' : 'Edit Tags'}
      headerAction={
        <IconButton onClick={onClose} size="small" disabled={busy}>
          <Icon icon={dismiss24Regular} width={20} />
        </IconButton>
      }
      maxWidth="md"
      actions={
        <>
          {mode === 'track' && (
            <Button
              disabled
              variant="outlined"
              startIcon={<Icon icon={mic24Regular} width={18} />}
              sx={{ mr: 'auto' }}
            >
              Lyrics Studio
            </Button>
          )}
          <Button onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={handleSave}
            disabled={busy || !isDirty || nothingWritable || !selectedTracks.length}
          >
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </>
      }
    >
      {loading ? (
        <Stack direction="row" spacing={1.5} alignItems="center" sx={{ py: 4 }}>
          <CircularProgress size={20} />
          <Typography variant="body2">Reading tags…</Typography>
        </Stack>
      ) : (
        <Stack spacing={2}>
          {error && <Alert severity="error">{error}</Alert>}

          {untaggable > 0 && (
            <Alert severity="warning">
              {nothingWritable
                ? 'This file format does not support tag editing.'
                : `${untaggable} of ${tracks.length} tracks are in a format that does not support tag editing, and cannot be selected.`}
            </Alert>
          )}

          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <Stack spacing={1} alignItems="center" sx={{ flexShrink: 0 }}>
              <Box
                component="img"
                src={artPreview ?? DEFAULT_AA}
                alt="Album art"
                sx={{
                  width: 160,
                  height: 160,
                  objectFit: 'cover',
                  borderRadius: 1,
                  bgcolor: 'action.hover',
                }}
              />
              <Stack direction="row" spacing={0.5}>
                <Button
                  size="small"
                  startIcon={<Icon icon={image24Regular} width={16} />}
                  onClick={handlePickArt}
                  disabled={nothingWritable}
                >
                  Change
                </Button>
                <Button
                  size="small"
                  color="error"
                  startIcon={<Icon icon={delete24Regular} width={16} />}
                  onClick={handleRemoveArt}
                  disabled={!artPreview || nothingWritable}
                >
                  Remove
                </Button>
              </Stack>

              {tracks.length > 1 && (
                <Stack alignItems="center" sx={{ maxWidth: 180 }}>
                  <FormControlLabel
                    sx={{ mr: 0 }}
                    control={
                      <Checkbox
                        size="small"
                        checked={artAll}
                        onChange={e => setArtAll(e.target.checked)}
                        disabled={saving || (artPath === undefined && !artSource)}
                      />
                    }
                    label={
                      <Typography variant="caption">Apply art beyond the selection</Typography>
                    }
                  />
                  <Typography variant="caption" color="text.secondary" align="center">
                    {artPath === null
                      ? `Removing cover from ${artTargets} of ${tracks.length} tracks`
                      : artPath !== undefined
                        ? `New cover → ${artTargets} of ${tracks.length} tracks`
                        : copyingArt
                          ? `Existing cover → ${artTargets} of ${tracks.length} tracks`
                          : `Embedded in ${artCount} of ${tracks.length} tracks`}
                  </Typography>
                </Stack>
              )}
            </Stack>

            <Box
              sx={{
                flex: 1,
                minWidth: 0,
                display: 'grid',
                gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' },
                gap: 2,
              }}
            >
              {fieldKeys.map(key => (
                <TagField
                  key={key}
                  def={FIELDS[key]}
                  value={values[key]}
                  options={choices[key] ?? []}
                  suggestions={key === 'genres' ? genreNames : undefined}
                  mixed={mixed.has(key)}
                  touched={touched.has(key)}
                  disabled={nothingWritable}
                  onChange={v => setField(key, v)}
                  onKeep={() => keepField(key)}
                />
              ))}
            </Box>
          </Stack>

          <Divider />
          <Stack direction="row" alignItems="center" spacing={0.5}>
            {tracks.length > 1 && (
              <Checkbox
                size="small"
                checked={selectedIds.size > 0 && selectedIds.size === taggableTracks.length}
                indeterminate={selectedIds.size > 0 && selectedIds.size < taggableTracks.length}
                onChange={toggleAll}
                disabled={saving || nothingWritable}
              />
            )}
            <Typography variant="subtitle2">
              Applies to {selectedTracks.length} of {taggableTracks.length} track
              {taggableTracks.length === 1 ? '' : 's'}
            </Typography>
          </Stack>
          <Box sx={{ pr: 1 }}>
            {tracks.map((t, i) => {
              const checked = selectedIds.has(t.Id);
              const writable = isTaggable(t.Uri);
              return (
                <Stack key={t.Id} direction="row" alignItems="center" spacing={0.5}>
                  {tracks.length > 1 && (
                    <Checkbox
                      size="small"
                      checked={checked}
                      onChange={() => toggleTrack(t.Id)}
                      disabled={saving || !writable}
                    />
                  )}
                  <Box sx={{ flex: 1, minWidth: 0, py: 0.25, opacity: checked ? 1 : 0.45 }}>
                    <Typography variant="body2" noWrap>
                      {i + 1}. {t.Title || t.Uri.split(/[\\/]/).pop() || t.Uri}
                    </Typography>
                    <Typography
                      variant="caption"
                      color="text.secondary"
                      noWrap
                      title={t.Uri}
                      sx={{ display: 'block' }}
                    >
                      {t.Uri}
                      {!writable && ' — not taggable'}
                      {hasArt[i] === false && ' — no cover'}
                    </Typography>
                  </Box>
                  {getsArt(t) && (
                    <Tooltip title={artPath === null ? 'Cover will be removed' : 'Gets the cover'}>
                      <Box sx={{ display: 'flex', color: 'primary.main' }}>
                        <Icon
                          icon={artPath === null ? delete24Regular : image24Regular}
                          width={16}
                        />
                      </Box>
                    </Tooltip>
                  )}
                  <Tooltip title="Track info">
                    <IconButton size="small" onClick={() => setInfoTrack(t)}>
                      <Icon icon={info24Regular} width={18} />
                    </IconButton>
                  </Tooltip>
                </Stack>
              );
            })}
          </Box>

          {infoTrack && (
            <SongInfoDialog
              open
              onClose={() => setInfoTrack(null)}
              track={{ ...infoTrack }}
              songPath={infoTrack.Uri}
            />
          )}
        </Stack>
      )}
    </AppDialog>
  );
}
