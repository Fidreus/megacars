// Summary of the usage log: npm run stats [-- --days 30]
// Reads DATA_DIR/analytics (default ./data/analytics).

import { resolve } from 'node:path';
import { formatSummary, readLog, summarize } from '../src/server/analyticsStats.ts';

const args = process.argv.slice(2);
const i = args.indexOf('--days');
const days = i >= 0 ? Math.max(1, Math.min(365, Number(args[i + 1]) || 7)) : 7;
const dir = resolve(process.env.DATA_DIR ?? resolve(import.meta.dirname, '../data'), 'analytics');
process.stdout.write(formatSummary(summarize(readLog(dir, days), days)));
