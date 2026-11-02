import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { AppService } from './app.service.js';

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
    );
  }
}
