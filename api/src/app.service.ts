import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Pool } from 'pg';

type ListingSummary = {
  listingId: string;
  name: string;
  pictureUrl: string | null;
  neighbourhood: string | null;
  roomType: string | null;
  propertyType: string | null;
  priceCad: string | null;
  accommodates: number | null;
  bedrooms: number | null;
  reviewScore: string | null;
};

type ListingsPage = {
  snapshotDate: string | null;
  total: number;
  limit: number;
  offset: number;
  items: ListingSummary[];
};

export type ListingDetail = {
  listingId: string;
  name: string;
  description: string | null;
  listingUrl: string | null;
  pictureUrl: string | null;
  neighbourhood: string | null;
  roomType: string | null;
  propertyType: string | null;
  priceCad: string | null;
  accommodates: number | null;
  bedrooms: number | null;
  beds: number | null;
  bathroomsText: string | null;
  amenities: string[];
  minimumNights: number | null;
  maximumNights: number | null;
  availability365: number | null;
  reviewScore: string | null;
  cleanlinessRating: string | null;
  locationRating: string | null;
};

// jsonb arrives untyped. Keep only strings before the dialog lists amenities.
function readAmenities(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  return value.filter((item): item is string => typeof item === 'string');
}

export type ListingSort =
  | 'name_asc'
  | 'name_desc'
  | 'price_asc'
  | 'price_desc'
  | 'rating_asc'
  | 'rating_desc';

// Turn an allowlisted sort into one fixed ORDER BY clause. The caller's text is
// not copied in. SQL cannot bind ASC or DESC, so this fragment is interpolated
// later. null uses the same order as name_asc. Price and rating place missing
// values last, then name and listing id.
export function listingOrderBy(sort: ListingSort | null): string {
  switch (sort) {
    case 'name_desc':
      return 'name desc, "listingId" asc';
    case 'price_asc':
      return '"priceValue" asc nulls last, name asc, "listingId" asc';
    case 'price_desc':
      return '"priceValue" desc nulls last, name asc, "listingId" asc';
    case 'rating_asc':
      return '"reviewScoreValue" asc nulls last, name asc, "listingId" asc';
    case 'rating_desc':
      return '"reviewScoreValue" desc nulls last, name asc, "listingId" asc';
    case 'name_asc':
    case null:
      return 'name asc, "listingId" asc';
    default: {
      const unexpected: never = sort;
      throw new Error(`Unsupported sort: ${String(unexpected)}`);
    }
  }
}

// Runs the listing reads. The controller validates arguments before they arrive.
@Injectable()
export class AppService implements OnModuleDestroy {
  private readonly pool: Pool;

  constructor() {
    const connectionString = process.env.DATABASE_URL;

    if (!connectionString) {
      throw new Error('DATABASE_URL is missing. Add it to api/.env.');
    }

    // One pool for the process. DATABASE_URL comes from api/.env. Traffic is
    // encrypted, but rejectUnauthorized: false does not verify the database
    // server's certificate.
    this.pool = new Pool({
      connectionString,
      ssl: { rejectUnauthorized: false },
    });
  }

  getHello(): string {
    return 'Hello World!';
  }

  async getDatabaseStatus(): Promise<{ database: string; user: string }> {
    const result = await this.pool.query(
      'select current_database() as database, current_user as user',
    );

    return result.rows[0];
  }

  // Read neighbourhood names that have listings in the latest Inside Airbnb
  // snapshot. Names with no listings in that snapshot are left out.
  async getNeighbourhoods(): Promise<string[]> {
    const result = await this.pool.query<{ name: string }>(
      `with latest_snapshot as (
         select id
         from public.dataset_snapshots
         where source = $1
         order by snapshot_date desc, id desc
         limit 1
       )
       select distinct n.name
       from latest_snapshot s
       join public.listings l on l.snapshot_id = s.id
       join public.neighbourhoods n on n.id = l.neighbourhood_id
       order by n.name`,
      ['Inside Airbnb'],
    );

    return result.rows.map((row) => row.name);
  }

  // Read one page from the latest Inside Airbnb snapshot. Select that snapshot,
  // apply neighbourhood, price, guests, and bedrooms, then sort and keep
  // limit/offset. The response also includes the filtered total and the
  // snapshot date. A null filter is ignored. orderBy is the fixed clause from
  // listingOrderBy, not the caller's raw sort text.
  async getListings(
    limit: number,
    offset: number,
    neighbourhood: string | null,
    minPrice: string | null,
    maxPrice: string | null,
    guests: number | null,
    bedrooms: number | null,
    sort: ListingSort | null,
  ): Promise<ListingsPage> {
    const orderBy = listingOrderBy(sort);
    const result = await this.pool.query<{
      snapshotDate: string | null;
      total: string;
      items: ListingSummary[];
    }>(
      `with latest_snapshot as (
         -- Newest Inside Airbnb row in dataset_snapshots.
         select id, snapshot_date::text as snapshot_date
         from public.dataset_snapshots
         where source = $1
         order by snapshot_date desc, id desc
         limit 1
       ),
       all_listings as (
         -- Card fields for that snapshot. The id and the displayed price stay text.
         select
           l.source_listing_id::text as "listingId",
           l.name,
           l.picture_url as "pictureUrl",
           n.name as neighbourhood,
           l.room_type as "roomType",
           l.property_type as "propertyType",
           l.price_cad as "priceValue",
           l.price_cad::text as "priceCad",
           l.accommodates,
           l.bedrooms,
           l.review_scores_rating as "reviewScoreValue",
           l.review_scores_rating::text as "reviewScore"
         from public.listings l
         join latest_snapshot s on s.id = l.snapshot_id
         left join public.neighbourhoods n on n.id = l.neighbourhood_id
       ),
       filtered_listings as (
         -- A null parameter skips that filter. Guests means at least that many.
         -- Bedrooms is an exact match. Prices stay text until this numeric cast.
         select
           "listingId",
           name,
           "pictureUrl",
           neighbourhood,
           "roomType",
           "propertyType",
           "priceCad",
           accommodates,
           bedrooms,
           "reviewScore",
           "priceValue",
           "reviewScoreValue"
         from all_listings
         where ($2::text is null or neighbourhood = $2)
           and ($3::numeric is null or "priceValue" >= $3)
           and ($4::numeric is null or "priceValue" <= $4)
           and ($5::integer is null or accommodates >= $5)
           and ($6::integer is null or bedrooms = $6)
       ),
       page as (
         -- Sort the filtered rows, then return one page.
         select
           "listingId",
           name,
           "pictureUrl",
           neighbourhood,
           "roomType",
           "propertyType",
           "priceCad",
           accommodates,
           bedrooms,
           "reviewScore",
           row_number() over (order by ${orderBy}) as ordinal
         from filtered_listings
         order by ordinal
         limit $7 offset $8
       )
       select
         (select snapshot_date from latest_snapshot) as "snapshotDate",
         (select count(*)::text from filtered_listings) as total,
         coalesce(
           (
             select json_agg((to_jsonb(page) - 'ordinal') order by page.ordinal)
             from page
           ),
           '[]'::json
         ) as items`,
      ['Inside Airbnb', neighbourhood, minPrice, maxPrice, guests, bedrooms, limit, offset],
    );

    const row = result.rows[0];

    return {
      snapshotDate: row.snapshotDate,
      // Count comes back as text. It is the filtered total, not the page length.
      total: Number(row.total),
      limit,
      offset,
      items: row.items,
    };
  }

  // Read one listing from that same latest snapshot, including description,
  // amenities, and availability. Returns null when this snapshot has no such
  // id. The id stays text here and is cast to bigint in SQL.
  async getListing(listingId: string): Promise<ListingDetail | null> {
    const result = await this.pool.query<
      Omit<ListingDetail, 'amenities'> & { amenities: unknown }
    >(
      `with latest_snapshot as (
         select id
         from public.dataset_snapshots
         where source = $1
         order by snapshot_date desc, id desc
         limit 1
       )
       select
         l.source_listing_id::text as "listingId",
         l.name,
         l.description,
         l.listing_url as "listingUrl",
         l.picture_url as "pictureUrl",
         n.name as neighbourhood,
         l.room_type as "roomType",
         l.property_type as "propertyType",
         l.price_cad::text as "priceCad",
         l.accommodates,
         l.bedrooms,
         l.beds,
         l.bathrooms_text as "bathroomsText",
         l.amenities,
         l.minimum_nights as "minimumNights",
         l.maximum_nights as "maximumNights",
         l.availability_365 as "availability365",
         l.review_scores_rating::text as "reviewScore",
         l.review_scores_cleanliness::text as "cleanlinessRating",
         l.review_scores_location::text as "locationRating"
       from public.listings l
       join latest_snapshot s on s.id = l.snapshot_id
       left join public.neighbourhoods n on n.id = l.neighbourhood_id
       where l.source_listing_id = $2::bigint`,
      ['Inside Airbnb', listingId],
    );

    const row = result.rows[0];
    if (!row) return null;

    return {
      ...row,
      amenities: readAmenities(row.amenities),
    };
  }

  // Release the pool when the shutdown hooks from main.ts run.
  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
