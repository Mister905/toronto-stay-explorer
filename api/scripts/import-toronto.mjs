import { createReadStream } from 'node:fs';
import { Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';
import { parse } from 'csv-parse';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import 'dotenv/config';
import pg from 'pg';

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, '../..');
const sourcePath = path.join(
  projectRoot,
  'data/source/toronto-listings-2026-09-16.csv.gz',
);

let rowCount = 0;
let invalidCount = 0;
let samplePrinted = false;

const validateRows = new Writable({
  objectMode: true,

  write(row, _encoding, callback) {
    rowCount += 1;

    const errors = [];

    // Keep this ID as text. It is too large for JavaScript Number precision.
    if (!/^\d+$/.test(row.id ?? '')) {
      errors.push('invalid listing ID');
    }

    if (!row.name?.trim()) {
      errors.push('missing name');
    }

    if (!row.neighbourhood_cleansed?.trim()) {
      errors.push('missing cleaned neighbourhood');
    }

    const accommodates = Number(row.accommodates);
    if (!Number.isInteger(accommodates) || accommodates < 1) {
      errors.push('invalid guest capacity');
    }

    if (errors.length > 0) {
      invalidCount += 1;
      if (invalidCount <= 5) {
        console.error(`Row ${rowCount}: ${errors.join(', ')}`);
      }
    }

    if (!samplePrinted) {
      console.log('Sample:', {
        sourceListingId: row.id,
        neighbourhood: row.neighbourhood_cleansed,
        price: row.price || null,
      });
      samplePrinted = true;
    }

    callback();
  },
});

try {
  await pipeline(
    createReadStream(sourcePath),
    createGunzip(),
    parse({ columns: true, bom: true, skip_empty_lines: true }),
    validateRows,
  );

  console.log(`Rows read: ${rowCount}`);
  console.log(`Rows with invalid required fields: ${invalidCount}`);

  if (rowCount === 0 || invalidCount > 0) {
    process.exitCode = 1;
  }

  const result = await pool.query(
    'select current_database() as database, current_user as user',
  );
  console.log('Database connection:', result.rows[0]);
} catch (error) {
  console.error('Could not read or validate the listings file:', error.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
