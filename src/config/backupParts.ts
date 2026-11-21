export type BackupPart =
  | 'settings'
  | 'folders'
  | 'playlists'
  | 'favourites'
  | 'history'
  | 'mood'
  | 'streams'
  | 'servers'
  | 'scrobbling';

export type BackupCounts = Partial<Record<BackupPart, number>>;

export const BACKUP_PARTS: Array<{
  id: BackupPart;
  label: string;
  detail: string;
  defaultOn: boolean;
}> = [
  {
    id: 'settings',
    label: 'Player settings',
    detail: 'Themes, equalizer, playback and view options',
    defaultOn: true,
  },
  {
    id: 'folders',
    label: 'Music sources (local)',
    detail: 'local folder locations',
    defaultOn: true,
  },
  {
    id: 'servers',
    label: 'Music sources (External / Servers)',
    detail: 'Note: Credentials will restore on the same machine only',
    defaultOn: false,
  },
  {
    id: 'playlists',
    label: 'Playlists',
    detail: 'Note: A playlist with the same name will be replaced on restore',
    defaultOn: true,
  },
  { id: 'favourites', label: 'Favourites', detail: 'Your favourited songs', defaultOn: true },
  {
    id: 'history',
    label: 'Play history',
    detail: 'Play counts, last played, and smart shuffle history',
    defaultOn: true,
  },
  {
    id: 'mood',
    label: 'Mood analysis',
    detail: 'All track analysis data made so far',
    defaultOn: true,
  },
  {
    id: 'streams',
    label: 'Radio streams',
    detail: 'Internet radio stations, their artwork and bookmarked tracks',
    defaultOn: true,
  },

  {
    id: 'scrobbling',
    label: 'Scrobbling accounts',
    detail: 'Note: Credentials will restore on the same machine only',
    defaultOn: false,
  },
];
