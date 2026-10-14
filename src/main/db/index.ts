import path from 'path';
import { APP_CONF_FOLDER } from '../../config/core_config';
import Database from 'better-sqlite3';

const dbPath = path.join(APP_CONF_FOLDER, 'data.db');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
export default db;
