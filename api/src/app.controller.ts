import {
  BadRequestException,
  Controller,
  Get,
  Query,
} from '@nestjs/common';
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
  ) {
    const limit = parseInteger('limit', limitQuery, 20);
    const offset = parseInteger('offset', offsetQuery, 0);
    const neighbourhood = neighbourhoodQuery?.trim() || null;

    if (limit < 1 || limit > 100) {
      throw new BadRequestException('limit must be between 1 and 100.');
    }

    if (neighbourhood && neighbourhood.length > 100) {
      throw new BadRequestException('neighbourhood is too long.');
    }

    return this.appService.getListings(limit, offset, neighbourhood);
  }
}