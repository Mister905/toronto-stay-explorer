import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Query,
} from '@nestjs/common';
import { AppService, type ListingSort } from './app.service.js';

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

const BIGINT_MAX = '9223372036854775807';

function parseListingId(value: string): string {
  if (!/^\d+$/.test(value)) {
    throw new BadRequestException('listingId must contain only digits.');
  }

  const normalized = value.replace(/^0+/, '') || '0';

  if (
    normalized.length > BIGINT_MAX.length ||
    (normalized.length === BIGINT_MAX.length && normalized > BIGINT_MAX)
  ) {
    throw new BadRequestException('listingId is too large.');
  }

  return value;
}

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
    const sort = sortQuery ? parseSort(sortQuery) : null;

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
