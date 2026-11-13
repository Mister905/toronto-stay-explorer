// Controller tests supply a fake AppService, so they never open PostgreSQL or read DATABASE_URL.
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller.js';
import { AppService, listingOrderBy } from './app.service.js';

interface ListingsQuery {
  limit?: string;
  offset?: string;
  neighbourhood?: string;
  minPrice?: string;
  maxPrice?: string;
  guests?: string;
  bedrooms?: string;
  sort?: string;
}

const emptyListingsPage = {
  snapshotDate: null,
  total: 0,
  limit: 20,
  offset: 0,
  items: [],
};

function requestListings(controller: AppController, query: ListingsQuery = {}) {
  return controller.getListings(
    query.limit,
    query.offset,
    query.neighbourhood,
    query.minPrice,
    query.maxPrice,
    query.guests,
    query.bedrooms,
    query.sort,
  );
}

function expectBadRequest(action: () => unknown, message: string): void {
  let thrown: unknown;

  try {
    action();
  } catch (error) {
    thrown = error;
  }

  expect(thrown).toBeInstanceOf(BadRequestException);
  expect((thrown as BadRequestException).message).toBe(message);
}

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        {
          provide: AppService,
          useValue: { getHello: () => 'Hello World!' },
        },
      ],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('root', () => {
    it('should return "Hello World!"', () => {
      expect(appController.getHello()).toBe('Hello World!');
    });
  });
});

// The sort clause is a fixed mapping. The controller forwards only an allowlisted value.
describe('listing sort', () => {
  it('orders by name when sort is omitted', () => {
    expect(listingOrderBy(null)).toBe('name asc, "listingId" asc');
    expect(listingOrderBy('name_asc')).toBe(listingOrderBy(null));
  });

  it('orders by the selected price or rating column', () => {
    expect(listingOrderBy('price_asc')).toContain('"priceValue" asc');
    expect(listingOrderBy('price_desc')).toContain('"priceValue" desc');
    expect(listingOrderBy('rating_asc')).toBe(
      '"reviewScoreValue" asc nulls last, name asc, "listingId" asc',
    );
    expect(listingOrderBy('rating_desc')).toContain('"reviewScoreValue" desc');
  });

  it('orders name from Z to A without changing the listing id tie-break', () => {
    expect(listingOrderBy('name_desc')).toBe('name desc, "listingId" asc');
  });

  it.each(['name_desc', 'rating_asc'] as const)(
    'accepts the inverse sort %s',
    async (sort) => {
      const getListings = vi.fn().mockResolvedValue({
        snapshotDate: null,
        total: 0,
        limit: 20,
        offset: 0,
        items: [],
      });
      const app: TestingModule = await Test.createTestingModule({
        controllers: [AppController],
        providers: [{ provide: AppService, useValue: { getListings } }],
      }).compile();
      const controller = app.get(AppController);

      await controller.getListings(
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        sort,
      );

      expect(getListings).toHaveBeenCalledWith(
        20,
        0,
        null,
        null,
        null,
        null,
        null,
        sort,
      );
    },
  );

  it('passes one validated sort value to the service', async () => {
    const getListings = vi.fn().mockResolvedValue({
      snapshotDate: null,
      total: 0,
      limit: 20,
      offset: 0,
      items: [],
    });
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [{ provide: AppService, useValue: { getListings } }],
    }).compile();
    const controller = app.get(AppController);

    await controller.getListings(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      'price_desc',
    );

    expect(getListings).toHaveBeenCalledWith(
      20,
      0,
      null,
      null,
      null,
      null,
      null,
      'price_desc',
    );
  });

  it('rejects a sort value the parser does not allow', async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [{ provide: AppService, useValue: { getListings: vi.fn() } }],
    }).compile();
    const controller = app.get(AppController);

    expect(() =>
      controller.getListings(
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        'newest',
      ),
    ).toThrow(BadRequestException);
  });
});

// Valid filters are parsed and passed through. Invalid input is rejected before the service.
describe('listing filters', () => {
  let controller: AppController;
  let getListings: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    getListings = vi.fn().mockResolvedValue(emptyListingsPage);
    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [{ provide: AppService, useValue: { getListings } }],
    }).compile();

    controller = moduleRef.get(AppController);
  });

  it('uses default pagination and leaves sort unset when queries are omitted', async () => {
    await requestListings(controller);

    expect(getListings).toHaveBeenCalledWith(
      20,
      0,
      null,
      null,
      null,
      null,
      null,
      null,
    );
  });

  it('passes parsed filters to the service', async () => {
    await requestListings(controller, {
      limit: '25',
      offset: '40',
      neighbourhood: '  Kensington-Chinatown  ',
      minPrice: '100.50',
      maxPrice: '250',
      guests: '4',
      bedrooms: '2',
    });

    expect(getListings).toHaveBeenCalledWith(
      25,
      40,
      'Kensington-Chinatown',
      '100.50',
      '250',
      4,
      2,
      null,
    );
  });

  it.each([
    ['0', 'limit must be between 1 and 100.'],
    ['101', 'limit must be between 1 and 100.'],
    ['-1', 'limit must be a non-negative integer.'],
    ['10.5', 'limit must be a non-negative integer.'],
  ] as const)('rejects limit %s', (limit, message) => {
    expectBadRequest(() => requestListings(controller, { limit }), message);
    expect(getListings).not.toHaveBeenCalled();
  });

  it.each([
    ['minPrice', '12.345'],
    ['minPrice', 'abc'],
    ['maxPrice', '-20'],
  ] as const)('rejects %s value %s', (field, value) => {
    expectBadRequest(
      () =>
        requestListings(
          controller,
          field === 'minPrice' ? { minPrice: value } : { maxPrice: value },
        ),
      `${field} must be a non-negative amount with up to two decimal places.`,
    );
    expect(getListings).not.toHaveBeenCalled();
  });

  it('rejects a minPrice greater than maxPrice', () => {
    expectBadRequest(
      () =>
        requestListings(controller, {
          minPrice: '200.00',
          maxPrice: '150',
        }),
      'minPrice cannot exceed maxPrice.',
    );
    expect(getListings).not.toHaveBeenCalled();
  });

  it.each([
    ['guests', '-1', 'guests must be a non-negative integer.'],
    ['bedrooms', '1.5', 'bedrooms must be a non-negative integer.'],
  ] as const)('rejects %s value %s', (field, value, message) => {
    expectBadRequest(
      () =>
        requestListings(
          controller,
          field === 'guests' ? { guests: value } : { bedrooms: value },
        ),
      message,
    );
    expect(getListings).not.toHaveBeenCalled();
  });

  it('accepts bedrooms=0 for a studio', async () => {
    await requestListings(controller, { bedrooms: '0' });

    expect(getListings).toHaveBeenCalledWith(
      20,
      0,
      null,
      null,
      null,
      null,
      0,
      null,
    );
  });
});

// Non-digits and ids past bigint are rejected. A valid unknown id becomes the controller 404.
describe('listing id', () => {
  let controller: AppController;
  let getListing: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    getListing = vi.fn().mockResolvedValue(null);
    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [{ provide: AppService, useValue: { getListing } }],
    }).compile();

    controller = moduleRef.get(AppController);
  });

  it.each([
    ['12a', 'listingId must contain only digits.'],
    ['9223372036854775808', 'listingId is too large.'],
  ] as const)('rejects listing id %s', async (listingId, message) => {
    let thrown: unknown;

    try {
      await controller.getListing(listingId);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(BadRequestException);
    expect((thrown as BadRequestException).message).toBe(message);
    expect(getListing).not.toHaveBeenCalled();
  });

  it('returns 404 when a valid listing id is unknown', async () => {
    let thrown: unknown;

    try {
      await controller.getListing('8675309');
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(NotFoundException);
    expect((thrown as NotFoundException).message).toBe('Listing not found.');
    expect((thrown as NotFoundException).getStatus()).toBe(404);
    expect(getListing).toHaveBeenCalledTimes(1);
    expect(getListing).toHaveBeenCalledWith('8675309');
  });
});
