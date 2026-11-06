import { useEffect, useRef, useState } from "react";

// A second request for one listing. Description, amenities, and availability are not on the card.
const API_BASE_URL = "http://localhost:3000";

// App mounts this while a card is selected. listingId is the stay to load.
// onClose clears that selection. returnFocusTo is the button that opened the dialog.
interface ListingDetailsDialogProps {
  listingId: string;
  onClose: () => void;
  returnFocusTo: HTMLElement | null;
}

interface ListingDetails {
  listingId: string;
  name: string;
  description: string | null;
  listingUrl: string | null;
  pictureUrl: string | null;
  neighbourhood: string | null;
  roomType: string | null;
  propertyType: string | null;
  priceCad: string | null;
  accommodates: number | null;
  bedrooms: number | null;
  beds: number | null;
  bathroomsText: string | null;
  amenities: string[];
  minimumNights: number | null;
  maximumNights: number | null;
  availability365: number | null;
  reviewScore: string | null;
  cleanlinessRating: string | null;
  locationRating: string | null;
}

type DetailsState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; listing: ListingDetails };

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

// Scores arrive as strings. Convert them to numbers so valid scores can be
// displayed consistently with a star and two decimal places. Missing or
// unreadable scores display as “Not yet rated.”
function formatRating(score: string | null): string {
  if (score === null) return "Not yet rated";

  const value = Number(score);
  // Number("abc") is NaN. Leave that as "Not yet rated" instead of a star rating.
  if (!Number.isFinite(value)) return "Not yet rated";

  return `★ ${value.toFixed(2)}`;
}

function formatBedrooms(bedrooms: number | null): string {
  if (bedrooms === null) return "Bedrooms unavailable";
  if (bedrooms === 0) return "Studio";
  return bedrooms === 1 ? "1 bedroom" : `${bedrooms} bedrooms`;
}

function formatCount(
  value: number | null,
  singular: string,
  unavailable: string,
): string {
  if (value === null) return unavailable;
  return value === 1 ? `1 ${singular}` : `${value} ${singular}s`;
}

// Show the source link only for http or https. Drop other schemes and invalid URLs.
function sourceUrl(value: string | null): string | null {
  if (!value) return null;

  try {
    const url = new URL(value);
    if (url.protocol === "http:" || url.protocol === "https:") {
      return url.toString();
    }
  } catch {
    return null;
  }

  return null;
}

// response.json() is untyped, so this checks the payload before it is rendered.
// listingId and name must be strings. The other text and number fields may be
// null, which the dialog shows as missing, but a value of the wrong type fails
// the check. Amenities must be an array of strings; an empty array is allowed.
// A failed check becomes the "incomplete" error instead of a partial listing.
// This checks types only, not ranges such as a rating from 0 to 5.
function isListingDetails(value: unknown): value is ListingDetails {
  if (typeof value !== "object" || value === null) return false;

  const listing = value as Record<string, unknown>;

  return (
    typeof listing.listingId === "string" &&
    typeof listing.name === "string" &&
    (listing.description === null || typeof listing.description === "string") &&
    (listing.listingUrl === null || typeof listing.listingUrl === "string") &&
    (listing.pictureUrl === null || typeof listing.pictureUrl === "string") &&
    (listing.neighbourhood === null ||
      typeof listing.neighbourhood === "string") &&
    (listing.roomType === null || typeof listing.roomType === "string") &&
    (listing.propertyType === null ||
      typeof listing.propertyType === "string") &&
    (listing.priceCad === null || typeof listing.priceCad === "string") &&
    (listing.accommodates === null ||
      typeof listing.accommodates === "number") &&
    (listing.bedrooms === null || typeof listing.bedrooms === "number") &&
    (listing.beds === null || typeof listing.beds === "number") &&
    (listing.bathroomsText === null ||
      typeof listing.bathroomsText === "string") &&
    Array.isArray(listing.amenities) &&
    listing.amenities.every((item) => typeof item === "string") &&
    (listing.minimumNights === null ||
      typeof listing.minimumNights === "number") &&
    (listing.maximumNights === null ||
      typeof listing.maximumNights === "number") &&
    (listing.availability365 === null ||
      typeof listing.availability365 === "number") &&
    (listing.reviewScore === null || typeof listing.reviewScore === "string") &&
    (listing.cleanlinessRating === null ||
      typeof listing.cleanlinessRating === "string") &&
    (listing.locationRating === null ||
      typeof listing.locationRating === "string")
  );
}

// Links and enabled buttons inside the dialog, in tab order. Those are the
// controls this dialog can focus: Close, Try again, and the source link when
// it is shown. The Tab handler uses the first and last to wrap focus inside
// the dialog. Without this list, Tab would move into the page behind it.
function focusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(
    container.querySelectorAll<HTMLElement>("a[href], button:not([disabled])"),
  );
}

const ListingDetailsDialog = ({
  listingId,
  onClose,
  returnFocusTo,
}: ListingDetailsDialogProps) => {
  // React stores the dialog's div here. The component uses it to find the
  // dialog's controls and keep keyboard focus inside the dialog.
  const dialogRef = useRef<HTMLDivElement>(null);

  // React stores the Close button here so the component can focus it when
  // the dialog opens.
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  // The Escape-key listener calls the latest onClose callback from this ref.
  // This lets the callback change without rebuilding the listener.
  const onCloseRef = useRef(onClose);
  const [reloadKey, setReloadKey] = useState(0);
  const [state, setState] = useState<DetailsState>({ status: "loading" });

  // The keyboard listener is not rebound every render, so it calls the latest onClose.
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    // Save the opener and current page scroll setting so both can be restored
    // when the dialog closes.
    const focusTarget = returnFocusTo;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    // Put keyboard focus on Close when the dialog opens.
    closeButtonRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }

      if (event.key !== "Tab" || !dialogRef.current) return;

      const items = focusableElements(dialogRef.current);
      if (items.length === 0) {
        event.preventDefault();
        return;
      }

      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;

      // Keep Tab inside the dialog by wrapping focus between its last and first
      // controls.
      if (event.shiftKey && (active === first || active === document.body)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;

      // Wait for this dialog to leave the page before restoring focus. If another
      // dialog is open, leave focus there instead.
      window.setTimeout(() => {
        if (document.querySelector('[role="dialog"]')) return;
        focusTarget?.focus();
      }, 0);
    };
  }, [returnFocusTo]);

  // Fetch this listing. A new id or Try again aborts the previous request, and
  // that abort is ignored so it cannot overwrite the newer result. 400 and 404
  // get specific messages. Any error can be retried. A payload that is not a
  // listing is rejected.
  useEffect(() => {
    const controller = new AbortController();

    async function loadDetails() {
      setState({ status: "loading" });

      try {
        const response = await fetch(
          `${API_BASE_URL}/listings/${encodeURIComponent(listingId)}`,
          { signal: controller.signal },
        );

        if (response.status === 404) {
          throw new Error("This listing could not be found.");
        }

        if (response.status === 400) {
          throw new Error("The listing ID is not valid.");
        }

        if (!response.ok) {
          throw new Error(`The listing API returned ${response.status}.`);
        }

        const payload: unknown = await response.json();
        if (!isListingDetails(payload)) {
          throw new Error("The listing details were incomplete.");
        }

        setState({ status: "ready", listing: payload });
      } catch (caughtError) {
        if (caughtError instanceof Error && caughtError.name === "AbortError") {
          return;
        }

        setState({
          status: "error",
          message:
            caughtError instanceof Error
              ? caughtError.message
              : "Unable to load this listing.",
        });
      }
    }

    void loadDetails();

    return () => controller.abort();
  }, [listingId, reloadKey]);

  // Render the stay only after a valid payload. Missing fields use fallback
  // text below. sourceUrl hides a missing or non-http(s) link.
  const listing = state.status === "ready" ? state.listing : null;
  const originalListingUrl = sourceUrl(listing?.listingUrl ?? null);

  // A click on the backdrop closes the dialog. Clicks inside the panel do not.
  return (
    <div className="listing-dialog-backdrop" onClick={onClose}>
      <div
        className="listing-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="listing-dialog-title"
        aria-busy={state.status === "loading"}
        ref={dialogRef}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="listing-dialog-toolbar">
          <button
            ref={closeButtonRef}
            className="listing-dialog-close"
            type="button"
            onClick={onClose}
          >
            Close
          </button>
        </div>

        <div className="listing-dialog-body">
          {state.status === "loading" && (
            <>
              <h2 id="listing-dialog-title">Listing details</h2>
              <p className="message" role="status">
                Loading listing details…
              </p>
            </>
          )}

          {state.status === "error" && (
            <>
              <h2 id="listing-dialog-title">Listing details</h2>
              <div className="message error-message" role="alert">
                <p>{state.message}</p>
                <button
                  className="text-button"
                  type="button"
                  onClick={() => setReloadKey((current) => current + 1)}
                >
                  Try again
                </button>
              </div>
            </>
          )}

          {listing && (
            <>
              <div className="listing-dialog-image">
                {listing.pictureUrl ? (
                  <img src={listing.pictureUrl} alt="" />
                ) : (
                  <div className="image-placeholder">Image unavailable</div>
                )}
              </div>

              <p className="listing-neighbourhood">
                {listing.neighbourhood ?? "Toronto"}
              </p>
              <h2 id="listing-dialog-title">{listing.name}</h2>
              <p className="listing-type">
                {listing.propertyType ?? "Property type not listed"}
                {listing.roomType ? ` · ${listing.roomType}` : ""}
              </p>

              <div className="listing-dialog-summary">
                <p className="listing-price">
                  <strong>{formatPrice(listing.priceCad)}</strong>
                  {listing.priceCad !== null && <span> / night</span>}
                </p>
                <ul className="listing-dialog-ratings">
                  <li>Overall {formatRating(listing.reviewScore)}</li>
                  <li>Cleanliness {formatRating(listing.cleanlinessRating)}</li>
                  <li>Location {formatRating(listing.locationRating)}</li>
                </ul>
              </div>

              <p className="listing-dialog-description">
                {listing.description?.trim() || "No description provided."}
              </p>

              <dl className="listing-dialog-facts">
                <div>
                  <dt>Guests</dt>
                  <dd>
                    {listing.accommodates === null
                      ? "Guest capacity unavailable"
                      : `Up to ${listing.accommodates}`}
                  </dd>
                </div>
                <div>
                  <dt>Bedrooms</dt>
                  <dd>{formatBedrooms(listing.bedrooms)}</dd>
                </div>
                <div>
                  <dt>Beds</dt>
                  <dd>
                    {formatCount(listing.beds, "bed", "Beds unavailable")}
                  </dd>
                </div>
                <div>
                  <dt>Bathrooms</dt>
                  <dd>{listing.bathroomsText ?? "Bathrooms unavailable"}</dd>
                </div>
                <div>
                  <dt>Minimum stay</dt>
                  <dd>
                    {formatCount(
                      listing.minimumNights,
                      "night",
                      "Minimum stay unavailable",
                    )}
                  </dd>
                </div>
                <div>
                  <dt>Maximum stay</dt>
                  <dd>
                    {formatCount(
                      listing.maximumNights,
                      "night",
                      "Maximum stay unavailable",
                    )}
                  </dd>
                </div>
                <div>
                  <dt>Availability</dt>
                  <dd>
                    {listing.availability365 === null
                      ? "Availability unavailable"
                      : `${listing.availability365} nights in the next 365 days`}
                  </dd>
                </div>
              </dl>

              <h3>Amenities</h3>
              {listing.amenities.length === 0 ? (
                <p className="listing-dialog-empty">No amenities listed.</p>
              ) : (
                <ul className="listing-dialog-amenities">
                  {listing.amenities.map((amenity, index) => (
                    <li key={`${amenity}-${index}`}>{amenity}</li>
                  ))}
                </ul>
              )}

              {originalListingUrl && (
                <a
                  className="listing-dialog-source"
                  href={originalListingUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  View the source listing
                </a>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default ListingDetailsDialog;
