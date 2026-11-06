import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Query,
} from '@nestjs/common';
import { AppService, type ListingSort } from './app.service.js';

// Query values arrive as strings. Only a non-negative integer continues to the service.
function parseInteger(
  name: string,
  value: string | undefined,
  defaultValue: number,
): number {
  if (value === undefined) return defaultValue;

  if (!/^\d+$/.test(value)) {
    throw new BadRequestException(`${name} must be a non-negative integer.`);
  }

  const parsed = Number(value);

  if (!Number.isSafeInteger(parsed)) {
    throw new BadRequestException(`${name} is too large.`);
  }

  return parsed;
}

// Keep a valid amount as text. JavaScript Number is binary floating point, so
// 19.99 can change before it is sent. The listings query binds this string as
// numeric, and PostgreSQL parses the original decimal. Number() below only
// rejects amounts that are too large.
function parsePrice(name: string, value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;

  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) {
    throw new BadRequestException(
      `${name} must be a non-negative amount with up to two decimal places.`,
    );
  }

  if (!Number.isFinite(Number(trimmed)) || Number(trimmed) > 99_999_999.99) {
    throw new BadRequestException(`${name} is too large.`);
  }

  return trimmed;
}

const sortOptions: readonly ListingSort[] = [
  'name_asc',
  'price_asc',
  'price_desc',
  'rating_desc',
];

// PostgreSQL bigint upper bound, compared as text. Number() would lose precision.
const BIGINT_MAX = '9223372036854775807';

// Reject non-digits and out-of-range ids. Leading zeros matter only for that check.
function parseListingId(value: string): string {
  if (!/^\d+$/.test(value)) {
    throw new BadRequestException('listingId must contain only digits.');
  }

  // Drop leading zeros so the range check sees the number, not the padding.
  // "009223372036854775807" is the maximum bigint with two extra zeros. Left
  // as-is, those 21 digits look too long and a valid id is rejected. A string
  // of only zeros becomes "0". The original id is still returned below.
  const normalized = value.replace(/^0+/, '') || '0';

  if (
    normalized.length > BIGINT_MAX.length ||
    (normalized.length === BIGINT_MAX.length && normalized > BIGINT_MAX)
  ) {
    throw new BadRequestException('listingId is too large.');
  }

  return value;
}

// Allowlist only. An unknown sort is a 400 and never becomes SQL.
function parseSort(value: string | undefined): ListingSort {
  if (value === undefined || value === 'name_asc') {
    return 'name_asc';
  }

  if (sortOptions.includes(value as ListingSort)) {
    return value as ListingSort;
  }

  throw new BadRequestException(
    'sort must be name_asc, price_asc, price_desc, or rating_desc.',
  );
}

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('health/db')
  getDatabaseStatus(): Promise<{ database: string; user: string }> {
    return this.appService.getDatabaseStatus();
  }

  @Get('neighbourhoods')
  getNeighbourhoods(): Promise<string[]> {
    return this.appService.getNeighbourhoods();
  }

  @Get('listings')
  getListings(
    @Query('limit') limitQuery?: string,
    @Query('offset') offsetQuery?: string,
    @Query('neighbourhood') neighbourhoodQuery?: string,
    @Query('minPrice') minPriceQuery?: string,
    @Query('maxPrice') maxPriceQuery?: string,
    @Query('guests') guestsQuery?: string,
    @Query('bedrooms') bedroomsQuery?: string,
    @Query('sort') sortQuery?: string,
  ) {
    const limit = parseInteger('limit', limitQuery, 20);
    const offset = parseInteger('offset', offsetQuery, 0);
    const neighbourhood = neighbourhoodQuery?.trim() || null;
    const minPrice = minPriceQuery
      ? parsePrice('minPrice', minPriceQuery)
      : null;
    const maxPrice = maxPriceQuery
      ? parsePrice('maxPrice', maxPriceQuery)
      : null;
    const guests = guestsQuery ? parseInteger('guests', guestsQuery, 1) : null;
    const bedrooms = bedroomsQuery
      ? parseInteger('bedrooms', bedroomsQuery, 1)
      : null;
    // Omitted sort stays null. The service orders that the same way as name_asc.
    const sort = sortQuery ? parseSort(sortQuery) : null;

    // The client asks for 12. An omitted limit defaults to 20 and must be 1–100.
    if (limit < 1 || limit > 100) {
      throw new BadRequestException('limit must be between 1 and 100.');
    }

    if (neighbourhood && neighbourhood.length > 100) {
      throw new BadRequestException('neighbourhood is too long.');
    }

    if (minPrice && maxPrice && Number(minPrice) > Number(maxPrice)) {
      throw new BadRequestException('minPrice cannot exceed maxPrice.');
    }

    return this.appService.getListings(
      limit,
      offset,
      neighbourhood,
      minPrice,
      maxPrice,
      guests,
      bedrooms,
      sort,
    );
  }

  // A valid id with no row in the latest snapshot is a 404, not an empty 200.
  @Get('listings/:listingId')
  async getListing(@Param('listingId') listingId: string) {
    const parsedListingId = parseListingId(listingId);
    const listing = await this.appService.getListing(parsedListingId);

    if (!listing) {
      throw new NotFoundException('Listing not found.');
    }

    return listing;
  }
}
