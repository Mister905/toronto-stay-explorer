import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller.js';
import { AppService, listingOrderBy } from './app.service.js';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [AppService],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('root', () => {
    it('should return "Hello World!"', () => {
      expect(appController.getHello()).toBe('Hello World!');
    });
  });
});

describe('listing sort', () => {
  it('orders by name when sort is omitted', () => {
    expect(listingOrderBy(null)).toBe('name asc, "listingId" asc');
    expect(listingOrderBy('name_asc')).toBe(listingOrderBy(null));
  });

  it('orders by the selected price or rating column', () => {
    expect(listingOrderBy('price_asc')).toContain('"priceValue" asc');
    expect(listingOrderBy('price_desc')).toContain('"priceValue" desc');
    expect(listingOrderBy('rating_desc')).toContain('"reviewScoreValue" desc');
  });

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
