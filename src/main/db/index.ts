import path from 'path';
import { APP_CONF_FOLDER } from '../../config/core_config';
import { fuzzyRank } from '../../config/fuzzyMatch';
import Database from 'better-sqlite3';

const dbPath = path.join(APP_CONF_FOLDER, 'data.db');
const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
// ponytail: full scan on the main process, ~165ms per 100k titles; add a trigram prefilter if slow.
db.function('fuzzy_rank', (text: unknown, query: string) => fuzzyRank(String(text ?? ''), query));
export default db;
