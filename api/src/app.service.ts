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

  async getListings(limit: number, offset: number): Promise<ListingsPage> {
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
           l.price_cad::text as "priceCad",
           l.accommodates,
           l.bedrooms,
           l.review_scores_rating::text as "reviewScore"
         from public.listings l
         join latest_snapshot s on s.id = l.snapshot_id
         left join public.neighbourhoods n on n.id = l.neighbourhood_id
       ),
       page as (
         select *
         from all_listings
         order by name, "listingId"
         limit $2 offset $3
       )
       select
         (select snapshot_date from latest_snapshot) as "snapshotDate",
         (select count(*)::text from all_listings) as total,
         coalesce(
           (select json_agg(page order by page.name, page."listingId") from page),
           '[]'::json
         ) as items`,
      ['Inside Airbnb', limit, offset],
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