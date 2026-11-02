import { useEffect, useState } from "react";
import "./App.css";

const API_BASE_URL = "http://localhost:3000";
const PAGE_SIZE = 12;

type Listing = {
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

function App() {
  const [page, setPage] = useState(0);
  const [reloadKey, setReloadKey] = useState(0);
  const [data, setData] = useState<ListingsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [neighbourhoods, setNeighbourhoods] = useState<string[]>([]);
  const [selectedNeighbourhood, setSelectedNeighbourhood] = useState("");
  const [neighbourhoodError, setNeighbourhoodError] = useState<string | null>(
    null,
  );

  useEffect(() => {
    const controller = new AbortController();

    async function loadNeighbourhoods() {
      try {
        const response = await fetch(`${API_BASE_URL}/neighbourhoods`, {
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(`The neighbourhood API returned ${response.status}.`);
        }

        const names = (await response.json()) as string[];
        setNeighbourhoods(names);
      } catch (caughtError) {
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

    void loadNeighbourhoods();

    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    async function loadListings() {
      setLoading(true);
      setError(null);

      const offset = page * PAGE_SIZE;
      const url = new URL("/listings", API_BASE_URL);
      url.searchParams.set("limit", String(PAGE_SIZE));
      url.searchParams.set("offset", String(offset));
      if (selectedNeighbourhood) {
        url.searchParams.set("neighbourhood", selectedNeighbourhood);
      }

      try {
        const response = await fetch(url, { signal: controller.signal });

        if (!response.ok) {
          throw new Error(`The listings API returned ${response.status}.`);
        }

        const listings = (await response.json()) as ListingsResponse;
        setData(listings);
      } catch (caughtError) {
        // Ignore the request cancelled when the page changes or unmounts.
        if (caughtError instanceof Error && caughtError.name === "AbortError") {
          return;
        }

        setError(
          caughtError instanceof Error
            ? caughtError.message
            : "Unable to load listings.",
        );
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }

    void loadListings();

    return () => controller.abort();
  }, [page, reloadKey, selectedNeighbourhood]);

  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const firstResult = total === 0 ? 0 : page * PAGE_SIZE + 1;
  const lastResult = Math.min((page + 1) * PAGE_SIZE, total);

  return (
    <div className="app-shell">
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

        <section className="results-section" aria-labelledby="results-heading">
          <div className="results-heading">
            <div>
              <p className="eyebrow">THE COLLECTION</p>
              <h2 id="results-heading">Stays in Toronto</h2>
            </div>

            {!loading && !error && (
              <p className="result-count" aria-live="polite">
                {total === 0
                  ? "No listings found"
                  : `Showing ${firstResult}–${lastResult} of ${total.toLocaleString("en-CA")}`}
              </p>
            )}
            <div className="results-controls">
              <label htmlFor="neighbourhood-filter">Neighbourhood</label>
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
            </div>
          </div>

          {loading && (
            <p className="message" role="status">
              Loading listings…
            </p>
          )}

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
                {data.items.map((listing) => (
                  <li key={listing.listingId}>
                    <article className="listing-card">
                      <div className="listing-image">
                        {listing.pictureUrl ? (
                          <img src={listing.pictureUrl} alt="" loading="lazy" />
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
                          {listing.propertyType ?? "Property type not listed"}
                        </p>

                        <div className="listing-facts">
                          <span>
                            {listing.accommodates === null
                              ? "Guest capacity unavailable"
                              : `Up to ${listing.accommodates} guests`}
                          </span>
                          <span>
                            {listing.bedrooms === null
                              ? "Bedrooms unavailable"
                              : listing.bedrooms === 0
                                ? "Studio"
                                : `${listing.bedrooms} bedrooms`}
                          </span>
                        </div>

                        <div className="listing-footer">
                          <p className="listing-price">
                            <strong>{formatPrice(listing.priceCad)}</strong>
                            {listing.priceCad !== null && <span> / night</span>}
                          </p>
                          <p className="listing-rating">
                            {listing.reviewScore === null
                              ? "Not yet rated"
                              : `★ ${Number(listing.reviewScore).toFixed(2)}`}
                          </p>
                        </div>
                      </div>
                    </article>
                  </li>
                ))}
              </ul>

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
  );
}

export default App;
