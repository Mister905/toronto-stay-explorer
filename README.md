# Toronto Stay Explorer

A local web app for browsing and comparing Toronto listings from a dated public snapshot. It is a study project for reading the data, not a booking site.

## What it does

The app shows pages of stays, with filters, sorting, listing details, and a comparison of up to three stays. Prices, ratings, and availability come from the snapshot. They are not live booking information.

## Stack

- **Client:** React, TypeScript, and Vite in `client/`
- **API:** NestJS and TypeScript in `api/`
- **Database:** PostgreSQL, used here through Supabase. The API connects with the `pg` driver.

The client at [http://localhost:5173](http://localhost:5173) calls the API at `http://localhost:3000`. The API reads the Inside Airbnb snapshot with the newest date already stored in this database. It does not download new files from Inside Airbnb. Opening a listing sends a second request. Comparison stays in the browser and does not call the API again.

## Features

- Browse listings, 12 at a time.
- Filter by neighbourhood, guest capacity (at least the number selected), exact bedroom count (Studio is zero), and an applied minimum and maximum price.
- Sort by name (the default), price low to high, price high to low, or rating.
- Move between pages.
- Open one listing for description, ratings, amenities, stay limits, snapshot availability, and a source link when the URL is http or https.
- Compare up to three stays already loaded on the cards.

## Data

The records are the Inside Airbnb Toronto listings file dated **2026-09-16**. The importer records that date, the source name Inside Airbnb, and this file URL:

[https://data.insideairbnb.com/canada/on/toronto/2026-09-16/data/listings.csv.gz](https://data.insideairbnb.com/canada/on/toronto/2026-09-16/data/listings.csv.gz)

The app footer attributes the data to [Inside Airbnb](https://insideairbnb.com/get-the-data/) under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Toronto Stay Explorer is an independent project and is not affiliated with Airbnb.

Download that file and save it as `data/source/toronto-listings-2026-09-16.csv.gz`. `data/source/` is gitignored.

## Local setup

### Prerequisites

- Node.js **22.23.4**, pinned in [`.nvmrc`](.nvmrc). From the repo root, `nvm use` selects it when nvm is installed.
- npm
- A PostgreSQL database and its connection string. This project uses Supabase. The password stays in `api/.env`.
- The schema in `database/migrations/` applied to that database. The repository has no migration command.
- The gzipped CSV above, saved at the path in [Data](#data).

### Install

```bash
cd api && npm install
cd ../client && npm install
```

### Configure the API

From `api/`:

```bash
cp .env.example .env
```

Set `DATABASE_URL` in `api/.env`. The example file only contains placeholders (`postgres.[PROJECT-REF]`, `[YOUR-PASSWORD]`, and `[POOLER-HOST]`). Do not commit `.env`. It is gitignored.

The API exits on startup if `DATABASE_URL` is missing. It listens on port 3000 unless `PORT` is set. CORS allows `http://localhost:5173` only.

### Apply the schema

Apply the SQL files once, in this order, before the first import. In the Supabase dashboard, open the SQL Editor, paste a file, and run it. Repeat for the next file.

1. `database/migrations/001_initial_schema.sql`
2. `database/migrations/002_enable_rls.sql`

### Download the listings file

Download the [Inside Airbnb Toronto listings file dated 2026-09-16](https://data.insideairbnb.com/canada/on/toronto/2026-09-16/data/listings.csv.gz) and save it as `data/source/toronto-listings-2026-09-16.csv.gz`, relative to the repository root. Create `data/source/` if it is not there. That directory is gitignored. The importer reads this local file and does not download it.

### Import

From `api/`, so the script can read `api/.env`:

```bash
node scripts/import-toronto.mjs
```

The import reads the gitignored CSV, validates it, then writes the snapshot. Re-running it updates the same source and date.

### Run

Use two terminals.

```bash
# Terminal 1, from api/
npm run start:dev
```

```bash
# Terminal 2, from client/
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). The client has no `start` script. Optional check: [http://localhost:3000/health/db](http://localhost:3000/health/db) returns JSON with `database` and `user` when the API can reach PostgreSQL. Do not share that output if it reveals account details.

## Build and test

These scripts are defined in the package files. This section describes them. It does not report a test run.

| Command | Where | What it does |
| --- | --- | --- |
| `npm run build` | `api/` | `nest build` |
| `npm run build` | `client/` | Typecheck and Vite build |
| `npm run lint` | `api/` or `client/` | Oxlint |
| `npm test` | `api/` | Vitest unit tests (`*.spec.ts`). They use a fake service, so they do not open PostgreSQL. They do not include the e2e test. |
| `npm run test:e2e` | `api/` | One `GET /` test that boots the real app module. That config does not load `.env`. Starting the app module needs `DATABASE_URL` in the environment. |
| `npm run test:cov` | `api/` | Unit tests with coverage |
| `npm run preview` | `client/` | Serves the client production build |

The client has no test script.
