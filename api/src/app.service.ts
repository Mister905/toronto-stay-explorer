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

@Injectable()
export class AppService implements OnModuleDestroy {
  private readonly pool: Pool;

  constructor() {
    const connectionString = process.env.DATABASE_URL;

    if (!connectionString) {
      throw new Error('DATABASE_URL is missing. Add it to api/.env.');
    }

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

  // Return neighbourhoods that have listings in the latest snapshot.
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

  async getListings(
    limit: number,
    offset: number,
    neighbourhood: string | null,
    minPrice: string | null,
    maxPrice: string | null,
    guests: number | null,
    bedrooms: number | null,
  ): Promise<ListingsPage> {
    const result = await this.pool.query<{
      snapshotDate: string | null;
      total: string;
      items: ListingSummary[];
    }>(
      `with latest_snapshot as (
         select id, snapshot_date::text as snapshot_date
         from public.dataset_snapshots
         where source = $1
         order by snapshot_date desc, id desc
         limit 1
       ),
       all_listings as (
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
           l.review_scores_rating::text as "reviewScore"
         from public.listings l
         join latest_snapshot s on s.id = l.snapshot_id
         left join public.neighbourhoods n on n.id = l.neighbourhood_id
       ),
       filtered_listings as (
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
           "reviewScore"
         from all_listings
         where ($2::text is null or neighbourhood = $2)
           and ($3::numeric is null or "priceValue" >= $3)
           and ($4::numeric is null or "priceValue" <= $4)
           and ($5::integer is null or accommodates >= $5)
           and ($6::integer is null or bedrooms = $6)
       ),
       page as (
         select *
         from filtered_listings
         order by name, "listingId"
         limit $7 offset $8
       )
       select
         (select snapshot_date from latest_snapshot) as "snapshotDate",
         (select count(*)::text from filtered_listings) as total,
         coalesce(
           (select json_agg(page order by page.name, page."listingId") from page),
           '[]'::json
         ) as items`,
      ['Inside Airbnb', neighbourhood, minPrice, maxPrice, guests, bedrooms, limit, offset],
    );

    const row = result.rows[0];

    return {
      snapshotDate: row.snapshotDate,
      total: Number(row.total),
      limit,
      offset,
      items: row.items,
    };
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
