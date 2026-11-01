create table dataset_snapshots (
  id bigint generated always as identity primary key,
  source text not null,
  source_url text not null,
  snapshot_date date not null,
  imported_at timestamptz not null default now(),
  unique (source, snapshot_date)
);

create table neighbourhoods (
  id bigint generated always as identity primary key,
  name text not null unique
);

create table listings (
  snapshot_id bigint not null references dataset_snapshots(id),
  source_listing_id bigint not null,
  neighbourhood_id bigint references neighbourhoods(id),

  name text not null,
  description text,
  picture_url text,
  listing_url text,

  latitude double precision,
  longitude double precision,

  property_type text,
  room_type text,
  accommodates integer,
  bedrooms integer,
  beds integer,
  bathrooms_text text,

  price_cad numeric(10, 2),
  amenities jsonb,

  minimum_nights integer,
  maximum_nights integer,
  has_availability boolean,
  availability_30 integer,
  availability_90 integer,
  availability_365 integer,

  number_of_reviews integer,
  number_of_reviews_ltm integer,
  review_scores_rating numeric(3, 2),
  review_scores_cleanliness numeric(3, 2),
  review_scores_location numeric(3, 2),
  last_review date,
  last_scraped date,

  primary key (snapshot_id, source_listing_id),

  check (latitude is null or latitude between -90 and 90),
  check (longitude is null or longitude between -180 and 180),
  check (accommodates is null or accommodates >= 1),
  check (bedrooms is null or bedrooms >= 0),
  check (beds is null or beds >= 1),
  check (price_cad is null or price_cad >= 0),
  check (review_scores_rating is null or review_scores_rating between 0 and 5),
  check (review_scores_cleanliness is null or review_scores_cleanliness between 0 and 5),
  check (review_scores_location is null or review_scores_location between 0 and 5),
  check (minimum_nights is null or minimum_nights >= 1),
  check (maximum_nights is null or maximum_nights >= 1),
  check (availability_30 is null or availability_30 between 0 and 30),
  check (availability_90 is null or availability_90 between 0 and 90),
  check (availability_365 is null or availability_365 between 0 and 365),
  check (number_of_reviews is null or number_of_reviews >= 0),
  check (number_of_reviews_ltm is null or number_of_reviews_ltm >= 0),
  check (amenities is null or jsonb_typeof(amenities) = 'array')
);

create index listings_snapshot_neighbourhood_idx
  on listings (snapshot_id, neighbourhood_id);

create index listings_snapshot_price_idx
  on listings (snapshot_id, price_cad);

create index listings_snapshot_room_type_idx
  on listings (snapshot_id, room_type);