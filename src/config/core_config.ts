import { app } from 'electron';
import path from 'path';
import fs from 'fs';
import os from 'os';

export const APP_CONF_FOLDER: string = app.getPath('userData');
export const MUSIC_DIR: string = path.join(os.homedir(), 'Music');
export const ALBUM_ART_DIR: string = path.join(APP_CONF_FOLDER, 'album_arts');
export const ARTIST_ART_DIR: string = path.join(APP_CONF_FOLDER, 'artist_arts');
// Unlike the two above, nothing can re-derive these, so they are never cleared wholesale.
export const STREAM_ART_DIR: string = path.join(APP_CONF_FOLDER, 'stream_arts');
export const FIRSTRUN_FILE: string = path.join(APP_CONF_FOLDER, 'firstrun');

try {
  if (!fs.existsSync(ALBUM_ART_DIR)) {
    fs.mkdirSync(ALBUM_ART_DIR);
  }
  if (!fs.existsSync(ARTIST_ART_DIR)) {
    fs.mkdirSync(ARTIST_ART_DIR);
  }
  if (!fs.existsSync(STREAM_ART_DIR)) {
    fs.mkdirSync(STREAM_ART_DIR);
  }
} catch (error) {
  console.log('Folder not Found: Creating...');
  console.log(error);
}
