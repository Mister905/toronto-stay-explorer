// Import one dated Inside Airbnb listings file into PostgreSQL.
//
// The script locates the project root from its own file path, then opens the
// gzipped CSV for this snapshot (data/source/toronto-listings-2026-09-16.csv.gz).
// It also keeps the source name, source URL, and snapshot date for the
// database record. Importing that same source and date again updates the
// existing snapshot and its listings.
//
// The CSV is read twice as a stream. Streaming decompresses and parses one
// row at a time, so the whole file does not have to sit in memory.
//
// First pass: decompress and parse every row, check the required fields
// (listing ID, name, neighbourhood, and guest capacity), and collect unique
// neighbourhood names. No database writes happen during this pass. If the
// file is empty or any required field is invalid, the import stops here.
//
// When validation succeeds, the script takes one database connection and
// starts a transaction. Inside that transaction it records the snapshot,
// adds any new neighbourhoods, and loads their database IDs.
//
// Second pass: stream the same file again. Each row is converted into a
// listing and held in a buffer. A full buffer is written with one query,
// which inserts the row or updates it when that snapshot and listing already
// exist. Batches are 500 rows. The listings insert uses 30 columns, so 500
// rows create 15,000 parameters, below PostgreSQL's limit of 65,535
// parameters in one query. Placeholders such as $1 and $2 point at those
// values. the values are passed separately from the SQL text, so CSV values
// are treated as data, not SQL code.
// A conversion error or a database error stops the stream. The transaction
// is then rolled back, which discards the snapshot, neighbourhoods, and
// listings together. If the second pass finishes, the transaction is
// committed. A successful import then prints the snapshot ID, how many
// neighbourhoods are available, and how many listings were imported. The
// connection pool is closed either way.

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

// The importer connects to Supabase from Node.js using a pool of reusable
// database connections. Like the API, it encrypts traffic but skips server
// certificate verification. This known limitation does not block the local
// demo; before relying on the app beyond the demo, configure Supabase's CA
// certificate and enable verification. Keep DATABASE_URL in api/.env, out of
// browser code.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// 1. Locate and configure the source file.
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

// PostgreSQL allows up to 65,535 parameters in one query. Each listing uses
// 30 parameters—one per column—so a batch of 500 listings uses 15,000.
// This keeps the batch below the protocol limit.
const batchSize = 500;

// These counters track the first pass through the CSV.
let rowCount = 0;
let invalidCount = 0;
// This flag lets the importer show one example row as an early sanity check:
// it helps confirm the CSV fields are being read as expected without printing
// thousands of rows. It starts as false. When the first row is parsed, the
// script prints its listing ID, neighbourhood, and price, then sets the flag
// to true so later rows do not print more samples.
let samplePrinted = false;

// A Set keeps each neighbourhood name only once.
const neighbourhoodNames = new Set();

// Return trimmed text, or null when the CSV field is blank.
// trim() removes whitespace from the start and end of a string.
function nullableText(value) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

// Convert a CSV number to a JavaScript number.
// Blank fields become null; prices have currency symbols and commas removed.
function nullableNumber(value) {
  const trimmed = value?.trim();
  if (!trimmed) return null;

  const number = Number(trimmed.replace(/[$,]/g, ''));
  if (!Number.isFinite(number)) {
    throw new Error(`Invalid numeric value: ${value}`);
  }

  return number;
}

// Convert an integer field from the CSV to a whole number.
// For example, accommodates can be 2 guests, but not 2.5. Blank fields stay null.
function nullableInteger(value) {
  const number = nullableNumber(value);
  if (number === null) return null;

  if (!Number.isInteger(number)) {
    throw new Error(`Invalid integer value: ${value}`);
  }

  return number;
}

// Convert CSV true/false values to JavaScript booleans.
function nullableBoolean(value) {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === 't' || normalized === 'true') return true;
  if (normalized === 'f' || normalized === 'false') return false;

  throw new Error(`Invalid boolean value: ${value}`);
}

// Parse the amenities field from JSON text in the CSV into a JavaScript array.
// e.g. ["Kitchen", "Washer", "Air conditioning"]
function nullableAmenities(value) {
  const trimmed = value?.trim();
  if (!trimmed) return null;

  const amenities = JSON.parse(trimmed);
  if (!Array.isArray(amenities)) {
    throw new Error('Amenities value is not a JSON array.');
  }

  return amenities;
}

// Convert one CSV row into values matching the listings table columns.
function listingValues(row, snapshotId, neighbourhoodIds) {
  const neighbourhoodName = row.neighbourhood_cleansed.trim();
  const neighbourhoodId = neighbourhoodIds.get(neighbourhoodName);

  // A missing ID means the neighbourhood lookup was not populated correctly.
  if (neighbourhoodId === undefined) {
    throw new Error(`Unknown neighbourhood: ${neighbourhoodName}`);
  }

  return [
    snapshotId,
    row.id, // Keep the large source ID as text to avoid JavaScript precision loss.
    neighbourhoodId,
    row.name.trim(),
    nullableText(row.description),
    nullableText(row.picture_url),
    nullableText(row.listing_url),
    nullableNumber(row.latitude),
    nullableNumber(row.longitude),
    nullableText(row.property_type),
    nullableText(row.room_type),
    nullableInteger(row.accommodates),
    nullableInteger(row.bedrooms),
    nullableInteger(row.beds),
    nullableText(row.bathrooms_text),
    nullableNumber(row.price),
    nullableAmenities(row.amenities),
    nullableInteger(row.minimum_nights),
    nullableInteger(row.maximum_nights),
    nullableBoolean(row.has_availability),
    nullableInteger(row.availability_30),
    nullableInteger(row.availability_90),
    nullableInteger(row.availability_365),
    nullableInteger(row.number_of_reviews),
    nullableInteger(row.number_of_reviews_ltm),
    nullableNumber(row.review_scores_rating),
    nullableNumber(row.review_scores_cleanliness),
    nullableNumber(row.review_scores_location),
    nullableText(row.last_review),
    nullableText(row.last_scraped),
  ];
}

// These are the columns in the same order as listingValues().
const listingColumns = [
  'snapshot_id',
  'source_listing_id',
  'neighbourhood_id',
  'name',
  'description',
  'picture_url',
  'listing_url',
  'latitude',
  'longitude',
  'property_type',
  'room_type',
  'accommodates',
  'bedrooms',
  'beds',
  'bathrooms_text',
  'price_cad',
  'amenities',
  'minimum_nights',
  'maximum_nights',
  'has_availability',
  'availability_30',
  'availability_90',
  'availability_365',
  'number_of_reviews',
  'number_of_reviews_ltm',
  'review_scores_rating',
  'review_scores_cleanliness',
  'review_scores_location',
  'last_review',
  'last_scraped',
];

// Create a writable stream that turns each parsed CSV row into a listing
// record and buffers those records. Writing a batch at a time uses fewer
// database queries than inserting one row at a time.
function createListingWriter(client, snapshotId, neighbourhoodIds) {
  let batch = [];
  let listingsWritten = 0;

  async function flushBatch() {
    if (batch.length === 0) return;

    // Flatten the batch into one list of parameter values. Numbered
    // placeholders such as ($1, $2, ...) then ($31, $32, ...) point at that
    // list. The values are passed to the query separately, not written into
    // the SQL text.
    const values = batch.flat();

    const valueGroups = batch.map((_, rowIndex) => {
      const placeholders = listingColumns.map((_, columnIndex) => {
        const parameterNumber =
          rowIndex * listingColumns.length + columnIndex + 1;
        return `$${parameterNumber}`;
      });

      return `(${placeholders.join(', ')})`;
    });

    // On reimport, match the existing row by (snapshot_id, source_listing_id).
    // slice(2) leaves those two identifying columns unchanged and updates every
    // remaining listing column.
    const updateColumns = listingColumns
      .slice(2)
      .map((column) => `${column} = excluded.${column}`);

    const sql = `
      insert into public.listings (${listingColumns.join(', ')})
      values ${valueGroups.join(', ')}
      on conflict (snapshot_id, source_listing_id)
      do update set ${updateColumns.join(', ')}
    `;

    await client.query(sql, values);

    listingsWritten += batch.length;
    batch = [];

    console.log(`Listings written: ${listingsWritten}`);
  }

  return new Writable({
    objectMode: true,

    write(row, _encoding, callback) {
      try {
        const values = listingValues(row, snapshotId, neighbourhoodIds);

        // amenities is listingColumns[16]. Turn the array into JSON text so
        // PostgreSQL can store it in the jsonb column. This index follows the
        // current column order and would be wrong if that order changed.
        if (values[16] !== null) {
          values[16] = JSON.stringify(values[16]);
        }

        batch.push(values);

        // Wait until a full batch finishes writing before calling callback().
        // Holding the callback applies backpressure, so the stream does not
        // accept more rows until this write completes. A database error is
        // passed to the pipeline through callback(error).
        if (batch.length >= batchSize) {
          flushBatch().then(
            () => callback(),
            (error) => callback(error),
          );
        } else {
          callback();
        }
      } catch (error) {
        // Conversion errors, such as a bad number or an unknown neighbourhood,
        // stop the pipeline the same way, through callback(error).
        callback(error);
      }
    },

    // When the CSV stream ends, write the last batch even if it is smaller
    // than batchSize. A flush error is passed to the pipeline through
    // callback(error).
    final(callback) {
      flushBatch().then(
        () => callback(),
        (error) => callback(error),
      );
    },
  });
}

// A Writable stream receives one parsed CSV row at a time during validation.
const validateRows = new Writable({
  objectMode: true,

  write(row, _encoding, callback) {
    rowCount += 1;

    const errors = [];

    // Keep this ID as text: it is too large for JavaScript Number precision.
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

    // Print one example row so the parsed values can be checked.
    if (!samplePrinted) {
      console.log('Sample:', {
        sourceListingId: row.id,
        neighbourhood: row.neighbourhood_cleansed,
        price: row.price || null,
      });
      samplePrinted = true;
    }

    // Collect distinct neighbourhood names for the database lookup.
    if (row.neighbourhood_cleansed?.trim()) {
      neighbourhoodNames.add(row.neighbourhood_cleansed.trim());
    }

    callback();
  },
});

try {
  // 2. First pass: parse and validate every CSV row before any database writes.
  // No database writes happen until this pass succeeds.
  await pipeline(
    createReadStream(sourcePath),
    createGunzip(),
    parse({ columns: true, bom: true, skip_empty_lines: true }),
    validateRows,
  );

  console.log(`Rows read: ${rowCount}`);
  console.log(`Rows with invalid required fields: ${invalidCount}`);

  if (rowCount === 0 || invalidCount > 0) {
    throw new Error('Validation failed; database writes were stopped.');
  }

  // 3. Start the database transaction.
  // Use one connection so all database changes share a transaction.
  const client = await pool.connect();

  try {
    await client.query('begin');

    // 4. Store the snapshot and neighbourhoods, then load their database IDs.
    // Create the snapshot record, or reuse the existing record for this date.
    const snapshotResult = await client.query(
      `insert into public.dataset_snapshots (source, source_url, snapshot_date)
       values ($1, $2, $3)
       on conflict (source, snapshot_date)
       do update set source_url = excluded.source_url
       returning id`,
      [sourceName, sourceUrl, snapshotDate],
    );

    const snapshotId = snapshotResult.rows[0].id;

    // Add neighbourhoods that aren't already in the lookup table.
    await client.query(
      `insert into public.neighbourhoods (name)
       select distinct name
       from unnest($1::text[]) as names(name)
       on conflict (name) do nothing`,
      [[...neighbourhoodNames]],
    );

    // Fetch database IDs for matching each CSV neighbourhood to its listing.
    const neighbourhoodResult = await client.query(
      `select id, name
       from public.neighbourhoods
       where name = any($1::text[])`,
      [[...neighbourhoodNames]],
    );

    const neighbourhoodIds = new Map(
      neighbourhoodResult.rows.map((row) => [row.name, row.id]),
    );

    // 5. Second pass: stream listing rows into PostgreSQL in batches.
    // Second pass: stream the CSV again and write listing rows in batches.
    const listingWriter = createListingWriter(
      client,
      snapshotId,
      neighbourhoodIds,
    );

    await pipeline(
      createReadStream(sourcePath),
      createGunzip(),
      parse({ columns: true, bom: true, skip_empty_lines: true }),
      listingWriter,
    );

    // 6. Commit on success or roll back on failure. Success path:
    // Commit snapshot, neighbourhood, and listing changes together.
    await client.query('commit');

    console.log('Snapshot record saved with ID:', snapshotId);
    console.log(`Neighbourhoods available: ${neighbourhoodIds.size}`);
    console.log(`Listings imported: ${rowCount}`);
  } catch (error) {
    // 6. Commit on success or roll back on failure. Failure path:
    // Undo all database changes if any part of the import fails.
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
} catch (error) {
  console.error('Import failed:', error.message);
  process.exitCode = 1;
} finally {
  // Close the pool so Node can exit cleanly.
  await pool.end();
}
