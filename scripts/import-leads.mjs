// Import a CSV of leads into SQLite.
//   node scripts/import-leads.mjs leads.csv
// CSV headers (case-insensitive): phone|number (required), company, timezone
import { importLeadsCsv, leadCounts } from '../src/data/lead-repo.js';

const path = process.argv[2];
if (!path) {
  console.error('usage: node scripts/import-leads.mjs <leads.csv>');
  process.exit(1);
}

const { ok, skipped } = importLeadsCsv(path);
console.log(`imported ${ok} lead(s), skipped ${skipped} (bad/blank phone)`);
console.log('lead status counts:', leadCounts());
process.exit(0);
