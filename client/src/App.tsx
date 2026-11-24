import { useEffect, useRef, useState } from "react";
import "./App.css";
import ComparePanel, { MAX_COMPARED_LISTINGS } from "./ComparePanel.tsx";
import ListingDetailsDialog from "./ListingDetailsDialog.tsx";

// Local API. It is a different origin from Vite, so CORS in the API must allow it.
const API_BASE_URL = "http://localhost:3000";
// The client requests 12 listings per page to fit its card layout
const PAGE_SIZE = 12;

type Listing = {
  // DEMO [1.40]: Card id stays a string, not a JavaScript number
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

type ListingsResponse = {
  snapshotDate: string | null;
  total: number;
  limit: number;
  offset: number;
  items: Listing[];
};

type ListingSort =
  | "name_asc"
  | "name_desc"
  | "price_asc"
  | "price_desc"
  | "rating_asc"
  | "rating_desc";

type SortOption = {
  value: ListingSort;
  label: string;
};

// DEMO [1.26]: Six sort names, including both directions
const sortOptions: SortOption[] = [
  { value: "name_asc", label: "Name: A to Z" },
  { value: "name_desc", label: "Name: Z to A" },
  { value: "price_asc", label: "Price: low to high" },
  { value: "price_desc", label: "Price: high to low" },
  { value: "rating_desc", label: "Rating: high to low" },
  { value: "rating_asc", label: "Rating: low to high" },
];

// Type guard: narrows `value` to `ListingSort`
function isListingSort(value: string): value is ListingSort {
  return sortOptions.some((option) => option.value === value);
}

function formatPrice(price: string | null): string {
  if (price === null) return "Price unavailable";

  const amount = Number(price);
  if (!Number.isFinite(amount)) return "Price unavailable";

  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
    maximumFractionDigits: 0,
  }).format(amount);
}

function formatGuestCapacity(accommodates: number | null): string {
  if (accommodates === null) return "Guest capacity unavailable";
  return accommodates === 1 ? "Up to 1 guest" : `Up to ${accommodates} guests`;
}

// DEMO [1.38]: Zero bedrooms is labeled Studio on the card
function formatCardBedrooms(bedrooms: number | null): string {
  if (bedrooms === null) return "Bedrooms unavailable";
  if (bedrooms === 0) return "Studio";
  return bedrooms === 1 ? "1 bedroom" : `${bedrooms} bedrooms`;
}

function App() {
  // Zero-based page. The listings request turns it into offset = page * PAGE_SIZE.
  const [page, setPage] = useState(0);
  // Try again increments this so the listings effect repeats the current query.
  const [reloadKey, setReloadKey] = useState(0);
  // Last successful page of listings. Stays null until the first response.
  const [data, setData] = useState<ListingsResponse | null>(null);
  // True on the first load and while a listings request is in flight.
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Names for the dropdown. Choosing one is a separate applied filter.
  const [neighbourhoods, setNeighbourhoods] = useState<string[]>([]);
  const [selectedNeighbourhood, setSelectedNeighbourhood] = useState("");
  const [neighbourhoodError, setNeighbourhoodError] = useState<string | null>(
    null,
  );
  // Guests and bedrooms apply as soon as their selects change.
  const [guests, setGuests] = useState("");
  const [bedrooms, setBedrooms] = useState("");
  // Price inputs stay local until Apply. priceRange is what the listings request uses.
  // DEMO [1.21]: Typing stays local until Apply updates priceRange
  const [minPriceInput, setMinPriceInput] = useState("");
  const [maxPriceInput, setMaxPriceInput] = useState("");
  const [priceRange, setPriceRange] = useState({
    minPrice: "",
    maxPrice: "",
  });
  const [priceError, setPriceError] = useState<string | null>(null);
  // Sent on every listings request. Changing it also returns to the first page.
  const [sort, setSort] = useState<ListingSort>("name_asc");
  // Set while details are open. The dialog receives id; opener is where focus returns.
  const [selectedListing, setSelectedListing] = useState<{
    id: string;
    opener: HTMLElement;
  } | null>(null);
  // Comparison is separate from paging and filters. It is not sent to the API.
  // DEMO [1.59]: Compare stores the card and sends no request
  // Selection lives in React state, not the URL
  const [comparedListings, setComparedListings] = useState<Listing[]>([]);
  // Remembers whether the user had selected stays to compare. This history
  // doesn't affect what the page displays, so a ref avoids an extra render.
  // After the user clears the stays, the effect moves keyboard focus to the
  // results heading so keyboard users know where to continue.
  const hadComparisonRef = useRef(false);

  // Load neighbourhood names when this component mounts. If the request fails,
  // show an error in the filters without blocking the listings request.
  useEffect(() => {
    // Cancel this request if its results are no longer needed, such as after the
    // user changes pages or the component unmounts.
    // DEMO [1.15]: Neighbourhood load aborts on its own controller
    const controller = new AbortController();

    async function loadNeighbourhoods() {
      try {
        // DEMO [1.14]: Menu names come from GET /neighbourhoods
        const response = await fetch(`${API_BASE_URL}/neighbourhoods`, {
          signal: controller.signal,
        });

        // fetch still resolves for an HTTP error, so a failed status is thrown here.
        if (!response.ok) {
          throw new Error(`The neighbourhood API returned ${response.status}.`);
        }

        const names = (await response.json()) as string[];
        setNeighbourhoods(names);
      } catch (caughtError) {
        // Unmount aborts the request. That cancellation is expected, so it is not shown.
        if (caughtError instanceof Error && caughtError.name === "AbortError") {
          return;
        }

        setNeighbourhoodError(
          caughtError instanceof Error
            ? caughtError.message
            : "Unable to load neighbourhoods.",
        );
      }
    }

    // Start the request without waiting. The effect must return the cleanup below immediately.
    void loadNeighbourhoods();

    // Abort on unmount so a late response cannot update state.
    return () => controller.abort();
  }, []);

  // DEMO [1.1]: This effect is the listings request from the demo. Listings reload when the page, sort, reload key, and other applied filters change.
  useEffect(() => {
    /*
    Create a controller for this request. The fetch uses its signal, and cleanup
    aborts the controller if these effect values change or the component unmounts.
  */
    // DEMO [1.4]: Each run has its own AbortController
    const controller = new AbortController();

    async function loadListings() {
      setLoading(true);
      setError(null);

      /*
      Request only the current page instead of sending every matching listing to
      the browser. `limit` sets how many listings to return; `offset` tells the API
      how many matching listings to skip first. For example, if 30 stays match and
      the page size is 12, page 1 uses offset 0 and returns stays 1–12; page 2 uses
      offset 12 and returns stays 13–24; page 3 uses offset 24 and returns stays
      25–30. Blank filters are omitted, so the API does not restrict results by
      those filters.
    */

      // DEMO [1.2]: URL params builder
      const offset = page * PAGE_SIZE;
      const url = new URL("/listings", API_BASE_URL);
      url.searchParams.set("limit", String(PAGE_SIZE));
      url.searchParams.set("offset", String(offset));
      // DEMO [1.19]: Selected neighbourhood is appended to the request
      if (selectedNeighbourhood) {
        url.searchParams.set("neighbourhood", selectedNeighbourhood);
      }
      // DEMO [1.24]: Only an applied price range is sent
      if (priceRange.minPrice) {
        url.searchParams.set("minPrice", priceRange.minPrice);
      }
      if (priceRange.maxPrice) {
        url.searchParams.set("maxPrice", priceRange.maxPrice);
      }
      // DEMO [1.33]: Guests 4 sends 4; 9+ sends 9
      if (guests) {
        url.searchParams.set("guests", guests);
      }
      // DEMO [1.36]: Studio sends 0; two bedrooms sends 2
      if (bedrooms) {
        url.searchParams.set("bedrooms", bedrooms);
      }
      // DEMO [1.3]: Sort is always sent, starting at name A to Z
      url.searchParams.set("sort", sort);

      try {
        /*
        Pass this controller's signal to fetch. When cleanup aborts the controller,
        fetch stops waiting for this request and rejects with an AbortError.
      */
        const response = await fetch(url, { signal: controller.signal });

        if (!response.ok) {
          throw new Error(`The listings API returned ${response.status}.`);
        }

        // DEMO [1.11]: List JSON is cast with no runtime check
        const listings = (await response.json()) as ListingsResponse;
        setData(listings);
      } catch (caughtError) {
        /*
        Cleanup causes an AbortError when it cancels this request. Ignore that
        expected cancellation instead of displaying it as a loading error.
      */
        // DEMO [1.5]: AbortError is ignored and shows no error
        if (caughtError instanceof Error && caughtError.name === "AbortError") {
          return;
        }

        setError(
          caughtError instanceof Error
            ? caughtError.message
            : "Unable to load listings.",
        );
      } finally {
        /*
        If this request was aborted, a newer effect run may already be loading.
        Only a request that wasn't aborted should clear the loading indicator.
      */
        // DEMO [1.6]: An aborted run must not clear the newer spinner
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }

    void loadListings();

    /*
      Abort this run's request when its dependencies change or the component unmounts.
      The next effect run creates a new controller and fetches with the updated values.
    */
    // DEMO [1.7]: Cleanup aborts this request before the next run
    return () => controller.abort();
  }, [
    page,
    reloadKey,
    selectedNeighbourhood,
    priceRange,
    guests,
    bedrooms,
    sort,
  ]);

  // When the user clears a non-empty comparison, move keyboard focus to the
  // results heading so there is a clear place to continue. Skip this when the
  // comparison was already empty, or when focus is already on another element.
  useEffect(() => {
    if (comparedListings.length > 0) {
      hadComparisonRef.current = true;
      return;
    }

    if (!hadComparisonRef.current) return;

    hadComparisonRef.current = false;

    if (document.activeElement === document.body) {
      document.getElementById("results-heading")?.focus();
    }
  }, [comparedListings.length]);

  // DEMO [1.60]: compareFull disables Add on the other cards
  const compareFull = comparedListings.length >= MAX_COMPARED_LISTINGS;

  // Store up to three card summaries here. This does not change the listings query.
  const toggleComparedListing = (listing: Listing) => {
    setComparedListings((current) => {
      const alreadySelected = current.some(
        (item) => item.listingId === listing.listingId,
      );

      if (alreadySelected) {
        return current.filter((item) => item.listingId !== listing.listingId);
      }

      // DEMO [1.61]: A fourth new stay is refused
      if (current.length >= MAX_COMPARED_LISTINGS) {
        return current;
      }

      return [...current, listing];
    });
  };

  const removeComparedListing = (listingId: string) => {
    setComparedListings((current) =>
      current.filter((item) => item.listingId !== listingId),
    );
  };

  const clearComparedListings = () => {
    setComparedListings([]);
  };

  // Display values for the summary and page controls. The API sends the total
  // count and this page of listings. The client uses the current page and
  // PAGE_SIZE to build text such as "Showing 25–30 of 30." While data is still
  // loading, and when nothing matches, the total is 0 and the range stays empty.
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const firstResult = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const lastResult = Math.min((page + 1) * PAGE_SIZE, total);

  return (
    <>
      {/* The page behind the details dialog is inert, so keyboard focus stays in the dialog. */}
      {/* DEMO [1.43]: inert takes the page shell out of use */}
      <div className="app-shell" inert={selectedListing !== null}>
        <header className="site-header">
          <a
            className="wordmark"
            href="/"
            aria-label="Toronto Stay Explorer home"
          >
            <span className="wordmark-mark" aria-hidden="true">
              T
            </span>
            <span>Toronto Stay Explorer</span>
          </a>
          <span className="header-note">
            An independent data exploration project
          </span>
        </header>

        <main>
          <section className="intro" aria-labelledby="page-title">
            <p className="eyebrow">TORONTO, ONTARIO</p>
            <h1 id="page-title">Find a stay that fits.</h1>
            <p className="intro-copy">
              Explore short-term rental listings across Toronto neighbourhoods.
            </p>

            <div className="dataset-note">
              <span className="status-dot" aria-hidden="true" />
              <span>
                {/* Use a general label while the API is loading or when no snapshot date is available. */}
                {data?.snapshotDate
                  ? `Dataset snapshot: ${data.snapshotDate}`
                  : "Toronto listing data"}
              </span>
              {data && (
                <span className="dataset-total">
                  {data.total.toLocaleString("en-CA")} listings
                </span>
              )}
            </div>
          </section>

          <section
            className="results-section"
            aria-labelledby="results-heading"
          >
            <div className="results-heading">
              <div>
                <p className="eyebrow">THE COLLECTION</p>
                <h2 id="results-heading" tabIndex={-1}>
                  Stays in Toronto
                </h2>
              </div>

              {!loading && !error && (
                <p className="result-count" aria-live="polite">
                  {total === 0
                    ? "No listings found"
                    : `Showing ${firstResult}–${lastResult} of ${total.toLocaleString("en-CA")}`}
                </p>
              )}
            </div>

            <div
              className="search-tool"
              role="group"
              aria-label="Filter listings"
            >
              {/* These selects apply immediately and return to page 1, so the new filter is not requested at an old offset. */}
              <label
                className="search-field field-neighbourhood"
                htmlFor="neighbourhood-filter"
              >
                Neighbourhood
                {/* DEMO [1.18]: Choosing the selected neighbourhood resets the page and refetches */}
                <select
                  id="neighbourhood-filter"
                  value={selectedNeighbourhood}
                  onChange={(event) => {
                    setPage(0);
                    setSelectedNeighbourhood(event.target.value);
                  }}
                >
                  <option value="">All Toronto</option>
                  {neighbourhoods.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>

              <label
                className="search-field field-guests"
                htmlFor="guests-filter"
              >
                Guests
                <select
                  id="guests-filter"
                  value={guests}
                  onChange={(event) => {
                    setPage(0);
                    setGuests(event.target.value);
                  }}
                >
                  <option value="">Any</option>
                  {[1, 2, 3, 4, 5, 6, 7, 8].map((count) => (
                    <option key={count} value={count}>
                      {count}
                    </option>
                  ))}
                  <option value="9">9+</option>
                </select>
              </label>

              <label
                className="search-field field-bedrooms"
                htmlFor="bedrooms-filter"
              >
                Bedrooms
                <select
                  id="bedrooms-filter"
                  value={bedrooms}
                  onChange={(event) => {
                    setPage(0);
                    setBedrooms(event.target.value);
                  }}
                >
                  <option value="">Any</option>
                  <option value="0">Studio</option>
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((count) => (
                    <option key={count} value={count}>
                      {count}
                    </option>
                  ))}
                </select>
              </label>

              <label className="search-field field-sort" htmlFor="sort-filter">
                Sort
                <select
                  id="sort-filter"
                  value={sort}
                  onChange={(event) => {
                    // DEMO [1.25]: Sort changes immediately and returns to page one
                    const nextSort = event.target.value;
                    if (!isListingSort(nextSort)) return;

                    // A new sort starts at page 1. Both changes are dependencies of the listings effect.
                    setPage(0);
                    setSort(nextSort);
                  }}
                >
                  {sortOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              {/* Price waits for Apply. An inverted range is rejected here and the current results stay. Clear resets the other filters and leaves sort unchanged. */}
              <form
                className="price-filter"
                onSubmit={(event) => {
                  event.preventDefault();

                  // DEMO [1.23]: Minimum above maximum returns before priceRange changes
                  if (
                    minPriceInput &&
                    maxPriceInput &&
                    Number(minPriceInput) > Number(maxPriceInput)
                  ) {
                    setPriceError("Minimum price cannot exceed maximum price.");
                    return;
                  }

                  setPriceError(null);
                  setPage(0);
                  // DEMO [1.22]: Apply copies both prices into the request
                  setPriceRange({
                    minPrice: minPriceInput.trim(),
                    maxPrice: maxPriceInput.trim(),
                  });
                }}
              >
                <label className="search-field">
                  Minimum price
                  <span className="price-input">
                    <span aria-hidden="true">$</span>
                    <input
                      type="number"
                      min="0"
                      max="99999999.99"
                      step="0.01"
                      value={minPriceInput}
                      onChange={(event) => setMinPriceInput(event.target.value)}
                      placeholder="Any"
                    />
                  </span>
                </label>

                <label className="search-field">
                  Maximum price
                  <span className="price-input">
                    <span aria-hidden="true">$</span>
                    <input
                      type="number"
                      min="0"
                      max="99999999.99"
                      step="0.01"
                      value={maxPriceInput}
                      onChange={(event) => setMaxPriceInput(event.target.value)}
                      placeholder="Any"
                    />
                  </span>
                </label>

                <div className="search-actions">
                  <button type="submit">Apply price</button>
                  {/* DEMO [1.39]: Clear resets filters and leaves the current sort */}
                  <button
                    type="button"
                    className="clear-filter"
                    onClick={() => {
                      // Clear applied filters and both price fields, then show page 1. Sort stays as it is.
                      setSelectedNeighbourhood("");
                      setMinPriceInput("");
                      setMaxPriceInput("");
                      setPriceRange({ minPrice: "", maxPrice: "" });
                      setPriceError(null);
                      setPage(0);
                      setGuests("");
                      setBedrooms("");
                    }}
                  >
                    Clear
                  </button>
                </div>

                {priceError && (
                  <p className="price-error" role="alert">
                    {priceError}
                  </p>
                )}
              </form>

              {neighbourhoodError && (
                <p className="filter-error" role="alert">
                  {neighbourhoodError}
                </p>
              )}
            </div>

            {/* comparedListings is client state only. The panel renders those summaries and does not fetch. */}
            <ComparePanel
              listings={comparedListings}
              onRemove={removeComparedListing}
              onClear={clearComparedListings}
            />

            {loading && (
              <p className="message" role="status">
                Loading listings…
              </p>
            )}

            {/* The Try again button increments reloadKey. That value is a dependency of the listings effect, so the failed request runs again.  */}
            {error && (
              <div className="message error-message" role="alert">
                <p>{error}</p>
                <button
                  className="text-button"
                  type="button"
                  onClick={() => setReloadKey((current) => current + 1)}
                >
                  Try again
                </button>
              </div>
            )}

            {!loading && !error && data?.items.length === 0 && (
              <p className="message">
                There are no listings to show on this page.
              </p>
            )}

            {!loading && !error && data && data.items.length > 0 && (
              <>
                <ul className="listing-grid">
                  {data.items.map((listing) => {
                    const isCompared = comparedListings.some(
                      (item) => item.listingId === listing.listingId,
                    );
                    const addDisabled = !isCompared && compareFull;
                    const listingName = listing.name.trim() || "this stay";
                    const priceKnown =
                      listing.priceCad !== null &&
                      Number.isFinite(Number(listing.priceCad));

                    return (
                      <li key={listing.listingId}>
                        {/* DEMO [1.12]: Card shows photo, facts, price, rating, and actions */}
                        <article
                          className={
                            isCompared
                              ? "listing-card is-compared"
                              : "listing-card"
                          }
                        >
                          <div className="listing-image">
                            {listing.pictureUrl ? (
                              <img
                                src={listing.pictureUrl}
                                alt=""
                                loading="lazy"
                              />
                            ) : (
                              <div className="image-placeholder">
                                Image unavailable
                              </div>
                            )}
                            <span className="room-badge">
                              {listing.roomType ?? "Room type not listed"}
                            </span>
                          </div>

                          <div className="listing-content">
                            <p className="listing-neighbourhood">
                              {listing.neighbourhood ?? "Toronto"}
                            </p>
                            <h3>{listing.name}</h3>
                            <p className="listing-type">
                              {listing.propertyType ??
                                "Property type not listed"}
                            </p>

                            <div className="listing-facts">
                              <span>
                                {formatGuestCapacity(listing.accommodates)}
                              </span>
                              <span>
                                {formatCardBedrooms(listing.bedrooms)}
                              </span>
                            </div>

                            <div className="listing-footer">
                              <p
                                className={
                                  priceKnown
                                    ? "listing-price"
                                    : "listing-price is-unavailable"
                                }
                              >
                                <strong>{formatPrice(listing.priceCad)}</strong>
                                {listing.priceCad !== null && (
                                  <span> / night</span>
                                )}
                              </p>
                              <p
                                className={
                                  listing.reviewScore === null
                                    ? "listing-rating is-unavailable"
                                    : "listing-rating"
                                }
                              >
                                {listing.reviewScore === null
                                  ? "Not yet rated"
                                  : `★ ${Number(listing.reviewScore).toFixed(2)}`}
                              </p>
                            </div>
                            <div className="listing-actions">
                              <button
                                className="details-button"
                                type="button"
                                onClick={(event) => {
                                  // Open details for this id. Remember the button so closing the dialog can return focus to it.
                                  // DEMO [1.41]: View details stores this card's id and button
                                  // Opening stores the id and the opener button
                                  setSelectedListing({
                                    id: listing.listingId,
                                    opener: event.currentTarget,
                                  });
                                }}
                              >
                                View details
                              </button>
                              <button
                                className={
                                  isCompared
                                    ? "compare-button is-selected"
                                    : "compare-button"
                                }
                                type="button"
                                disabled={addDisabled}
                                aria-label={
                                  isCompared
                                    ? `Remove ${listingName} from compare`
                                    : addDisabled
                                      ? `Add ${listingName} to compare. You can compare up to 3 stays.`
                                      : `Add ${listingName} to compare`
                                }
                                onClick={() => toggleComparedListing(listing)}
                              >
                                {isCompared
                                  ? "Remove from compare"
                                  : "Add to compare"}
                              </button>
                            </div>
                          </div>
                        </article>
                      </li>
                    );
                  })}
                </ul>

                {/* Previous and Next only change page. The listings effect turns that into a new offset. */}
                <nav className="pagination" aria-label="Listing pages">
                  <button
                    type="button"
                    onClick={() => setPage((current) => current - 1)}
                    disabled={page === 0 || loading}
                  >
                    Previous
                  </button>
                  <span>
                    Page {page + 1} of {totalPages}
                  </span>
                  <button
                    type="button"
                    onClick={() => setPage((current) => current + 1)}
                    disabled={page + 1 >= totalPages || loading}
                  >
                    Next
                  </button>
                </nav>
              </>
            )}
          </section>
        </main>

        <footer className="site-footer">
          <p>
            Data from{" "}
            <a
              href="https://insideairbnb.com/get-the-data/"
              target="_blank"
              rel="noreferrer"
            >
              Inside Airbnb
            </a>
            , licensed under{" "}
            <a
              href="https://creativecommons.org/licenses/by/4.0/"
              target="_blank"
              rel="noreferrer"
            >
              CC BY 4.0
            </a>
            .
          </p>
          <p>
            Toronto Stay Explorer is an independent project, not affiliated with
            Airbnb.
          </p>
        </footer>
      </div>
      {/* Mounting the dialog with this id starts its own details request. This page does not fetch the details. */}
      {/* DEMO [1.42]: Mounting the dialog starts the second request */}
      {selectedListing && (
        <ListingDetailsDialog
          listingId={selectedListing.id} // Identifies which listing's details to load.
          returnFocusTo={selectedListing.opener} // Returns keyboard focus to the button that opened the dialog.
          onClose={() => setSelectedListing(null)} // Clears the selection and closes the dialog.
        />
      )}
    </>
  );
}

export default App;
