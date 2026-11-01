// Read files and create the streams needed to process the compressed CSV.
import { createReadStream } from 'node:fs';
import { Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';

// Parse CSV rows into JavaScript objects, using each column header as a key.
import { parse } from 'csv-parse';

// Build paths relative to this script so it works from any working directory.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Load DATABASE_URL from api/.env.
import 'dotenv/config';

// Use node-postgres to connect to PostgreSQL.
import pg from 'pg';

const { Pool } = pg;

// Stop early with a clear message if the database connection string is missing.
if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is missing. Add it to api/.env.');
}

// Create a connection pool for communicating with Supabase Postgres.
// SSL is required for this hosted database connection.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// Find the project root based on this script's location.
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDirectory, '../..');

// Point to the downloaded, gzipped Inside Airbnb listings file.
const sourcePath = path.join(
  projectRoot,
  'data/source/toronto-listings-2026-09-16.csv.gz',
);

// Record the source and date for this dataset snapshot in the database.
const snapshotDate = '2026-09-16';
const sourceName = 'Inside Airbnb';
const sourceUrl =
  'https://data.insideairbnb.com/canada/on/toronto/2026-09-16/data/listings.csv.gz';

// Track validation results while the CSV streams through the script.
let rowCount = 0;
let invalidCount = 0;
let samplePrinted = false;

// A Set keeps each neighbourhood name only once.
const neighbourhoodNames = new Set();

// A Writable stream receives one parsed CSV row at a time.
const validateRows = new Writable({
  objectMode: true,

  write(row, _encoding, callback) {
    rowCount += 1;

    const errors = [];

    // Keep this ID as text: it is too large for JavaScript Number precision.
    if (!/^\d+$/.test(row.id ?? '')) {
      errors.push('invalid listing ID');
    }

    // These fields are required for each listing we plan to import.
    if (!row.name?.trim()) {
      errors.push('missing name');
    }

    if (!row.neighbourhood_cleansed?.trim()) {
      errors.push('missing cleaned neighbourhood');
    }

    // Guest capacity must be a whole number of at least one.
    const accommodates = Number(row.accommodates);
    if (!Number.isInteger(accommodates) || accommodates < 1) {
      errors.push('invalid guest capacity');
    }

    // Count invalid rows and print details for the first five only.
    if (errors.length > 0) {
      invalidCount += 1;
      if (invalidCount <= 5) {
        console.error(`Row ${rowCount}: ${errors.join(', ')}`);
      }
    }

    // Print one example row to make it easier to check the parsed data.
    if (!samplePrinted) {
      console.log('Sample:', {
        sourceListingId: row.id,
        neighbourhood: row.neighbourhood_cleansed,
        price: row.price || null,
      });
      samplePrinted = true;
    }

    // Collect neighbourhood names for insertion after validation.
    if (row.neighbourhood_cleansed?.trim()) {
      neighbourhoodNames.add(row.neighbourhood_cleansed.trim());
    }

    // Tell the stream this row has finished processing.
    callback();
  },
});

try {
  // Stream the file through decompression, CSV parsing, and validation.
  // This avoids loading the entire dataset into memory at once.
  await pipeline(
    createReadStream(sourcePath),
    createGunzip(),
    parse({ columns: true, bom: true, skip_empty_lines: true }),
    validateRows,
  );

  console.log(`Rows read: ${rowCount}`);
  console.log(`Rows with invalid required fields: ${invalidCount}`);

  // Do not write anything to the database if validation failed.
  if (rowCount === 0 || invalidCount > 0) {
    throw new Error('Validation failed; database writes were stopped.');
  }

  // Get one database connection so all writes use the same transaction.
  const client = await pool.connect();

  try {
    // Start a transaction so the snapshot and neighbourhood writes succeed
    // together, or can be rolled back together if something goes wrong.
    await client.query('begin');

    // Create the dataset snapshot record, or update its source URL if this
    // source and date have already been imported. Return its database ID.
    const snapshotResult = await client.query(
      `insert into public.dataset_snapshots (source, source_url, snapshot_date)
       values ($1, $2, $3)
       on conflict (source, snapshot_date)
       do update set source_url = excluded.source_url
       returning id`,
      [sourceName, sourceUrl, snapshotDate],
    );

    // Insert all distinct neighbourhood names. Existing names are left alone.
    await client.query(
      `insert into public.neighbourhoods (name)
       select distinct name
       from unnest($1::text[]) as names(name)
       on conflict (name) do nothing`,
      [[...neighbourhoodNames]],
    );

    // Make the transaction's changes permanent.
    await client.query('commit');

    console.log('Snapshot record saved with ID:', snapshotResult.rows[0].id);
    console.log(`Neighbourhoods found in CSV: ${neighbourhoodNames.size}`);
  } catch (error) {
    // Undo all writes in this transaction if any database step failed.
    await client.query('rollback');
    throw error;
  } finally {
    // Return the connection to the pool whether the transaction passed or not.
    client.release();
  }
} catch (error) {
  console.error('Import preparation failed:', error.message);
  process.exitCode = 1;
} finally {
  // Close the pool so the script can exit cleanly.
  await pool.end();
}
