# Toronto Stay Explorer

A local web app for browsing and comparing Toronto listings from a dated public snapshot. It is a study project for reading the data, not a booking site.

## What it does

The app shows pages of stays, with filters, sorting, listing details, and a comparison of up to three stays. Prices, ratings, and availability come from the snapshot. They are not live booking information.

## Stack

- **Client:** React, TypeScript, and Vite in `client/`
- **API:** NestJS and TypeScript in `api/`
- **Database:** PostgreSQL, used here through Supabase. The API connects with the `pg` driver.

The client at [http://localhost:5173](http://localhost:5173) calls the API at `http://localhost:3000`. The API reads the latest Inside Airbnb snapshot. Opening a listing sends a second request. Comparison stays in the browser and does not call the API again.

## Features

- Browse listings, 12 at a time.
- Filter by neighbourhood, guest capacity (at least the number selected), exact bedroom count (Studio is zero), and an applied minimum and maximum price.
- Sort by name (the default), price low to high, price high to low, or rating.
- Move between pages.
- Open one listing for description, ratings, amenities, stay limits, snapshot availability, and a source link when the URL is http or https.
- Compare up to three stays already loaded on the cards.

## Data

The records are the Inside Airbnb Toronto listings file dated **2026-09-16**. The importer records that date, the source name Inside Airbnb, and this file URL:

`https://data.insideairbnb.com/canada/on/toronto/2026-09-16/data/listings.csv.gz`

The app footer attributes the data to [Inside Airbnb](https://insideairbnb.com/get-the-data/) under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Toronto Stay Explorer is an independent project and is not affiliated with Airbnb.

The local CSV belongs at `data/source/toronto-listings-2026-09-16.csv.gz`. That directory is gitignored.

## Local setup

The repository uses the `master` branch.

### Prerequisites

- Node.js **22.23.4**, pinned in [`.nvmrc`](.nvmrc). From the repo root, `nvm use` selects it when nvm is installed.
- npm
- A PostgreSQL database and its connection string. This project uses Supabase. The password stays in `api/.env`.
- The schema in `database/migrations/` applied to that database. There is no migration command in `package.json`.
- The gzipped CSV above, if you need to import.

This README was checked with the shell on Node v22.12.0. That version is older than 22.23.4. The Nest CLI range recorded in `api/package-lock.json` is `^22.22.3 || ^24.15.0 || >=26.0.0`. Use the pinned version before starting the API. The start commands below were not re-run for this edit.

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

### Import

Apply `database/migrations/001_initial_schema.sql` and `database/migrations/002_enable_rls.sql` before the first import. From `api/`, so the script can read `api/.env`:

```bash
node scripts/import-toronto.mjs
```

The import reads the gitignored CSV, validates it, then writes the snapshot. Re-running it updates the same source and date. This command was not run while updating the README.

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

These scripts exist. On 2026-11-04, `npm test` from `api/` was run with Vitest 4.1.12 on Node 22.23.4. That unit run reported 1 file passed and 21 tests passed. It did not include the e2e test. The other commands below were not run for this README.

| Command | Where | What it does | Checked |
| --- | --- | --- | --- |
| `npm run build` | `api/` | `nest build` | Not run |
| `npm run build` | `client/` | Typecheck and Vite build | Not run |
| `npm run lint` | `api/` or `client/` | Oxlint | Not run |
| `npm test` | `api/` | Vitest unit tests | Run on 2026-11-04. 1 file passed, 21 tests passed. E2e not included |
| `npm run test:e2e` | `api/` | One `GET /` test that boots the real app module | Not run |
| `npm run test:cov` | `api/` | Unit tests with coverage | Not run |
| `npm run preview` | `client/` | Serves the client production build | Not run |

The client has no test script.

`npm run test:e2e` was not part of that unit run. It boots the real app module, its config does not load `.env`, and it needs `DATABASE_URL`.

## Current scope and limitations

The app runs locally. The client API address and the CORS origin are hardcoded to localhost. Nothing in this repository is a deployed environment. `api` includes a Nest `deploy` script; that is not a deployment of this project.

`002_enable_rls.sql` enables row level security and does not add policies. The API and the importer connect with `ssl: { rejectUnauthorized: false }`.

These ideas are not built. They are optional later work, not completed features and not employer requirements:

- property-type filter
- rating filter
- amenity comparison
- market insights
- deployment
