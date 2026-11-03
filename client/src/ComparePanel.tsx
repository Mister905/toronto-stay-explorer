export const MAX_COMPARED_LISTINGS = 3;

export interface ComparableListing {
  listingId: string;
  name: string;
  neighbourhood: string | null;
  roomType: string | null;
  priceCad: string | null;
  accommodates: number | null;
  bedrooms: number | null;
  reviewScore: string | null;
}

interface ComparePanelProps {
  listings: ComparableListing[];
  onRemove: (listingId: string) => void;
  onClear: () => void;
}

interface CompareCell {
  text: string;
  unavailable: boolean;
}

interface CompareField {
  id: string;
  label: string;
  value: (listing: ComparableListing) => CompareCell;
}

function unavailable(text: string): CompareCell {
  return { text, unavailable: true };
}

function available(text: string): CompareCell {
  return { text, unavailable: false };
}

function textOrUnavailable(
  value: string | null,
  unavailableLabel: string,
): CompareCell {
  if (value === null || value.trim() === "") {
    return unavailable(unavailableLabel);
  }

  return available(value);
}

function formatName(name: string): CompareCell {
  return textOrUnavailable(name, "Name unavailable");
}

function formatPrice(price: string | null): CompareCell {
  if (price === null || price.trim() === "") {
    return unavailable("Price unavailable");
  }

  const amount = Number(price);
  if (!Number.isFinite(amount)) {
    return unavailable("Price unavailable");
  }

  return available(
    new Intl.NumberFormat("en-CA", {
      style: "currency",
      currency: "CAD",
      maximumFractionDigits: 0,
    }).format(amount),
  );
}

function formatGuests(value: number | null): CompareCell {
  if (value === null) return unavailable("Guest capacity unavailable");
  if (value === 1) return available("Up to 1 guest");
  return available(`Up to ${value} guests`);
}

function formatBedrooms(value: number | null): CompareCell {
  if (value === null) return unavailable("Bedrooms unavailable");
  if (value === 0) return available("Studio");
  if (value === 1) return available("1 bedroom");
  return available(`${value} bedrooms`);
}

function formatRating(value: string | null): CompareCell {
  if (value === null || value.trim() === "") {
    return unavailable("Rating unavailable");
  }

  const score = Number(value);
  if (!Number.isFinite(score)) return unavailable("Rating unavailable");

  return available(`★ ${score.toFixed(2)}`);
}

const compareFields: CompareField[] = [
  { id: "name", label: "Name", value: (listing) => formatName(listing.name) },
  {
    id: "neighbourhood",
    label: "Neighbourhood",
    value: (listing) =>
      textOrUnavailable(listing.neighbourhood, "Neighbourhood unavailable"),
  },
  {
    id: "price",
    label: "Nightly price",
    value: (listing) => formatPrice(listing.priceCad),
  },
  {
    id: "roomType",
    label: "Room type",
    value: (listing) =>
      textOrUnavailable(listing.roomType, "Room type unavailable"),
  },
  {
    id: "guests",
    label: "Guest capacity",
    value: (listing) => formatGuests(listing.accommodates),
  },
  {
    id: "bedrooms",
    label: "Bedrooms",
    value: (listing) => formatBedrooms(listing.bedrooms),
  },
  {
    id: "rating",
    label: "Rating",
    value: (listing) => formatRating(listing.reviewScore),
  },
];

function statusMessage(count: number): string {
  if (count <= 1) {
    return "Add another stay to compare them side by side. You can compare up to 3 stays.";
  }

  if (count === 2) {
    return "Comparing 2 stays side by side. You can add one more.";
  }

  return "Comparing 3 stays side by side. Remove one to add a different stay.";
}

interface CompareColumnsProps {
  listings: ComparableListing[];
  onRemove: (listingId: string) => void;
}

const CompareColumns = ({ listings, onRemove }: CompareColumnsProps) => (
  <>
    <p className="compare-scroll-hint" aria-hidden="true">
      Swipe sideways to compare every stay.
    </p>
    <div className="compare-scroll">
      <table className="compare-table" data-count={listings.length}>
        <caption className="visually-hidden">
          Side-by-side comparison of {listings.length} stays
        </caption>
        <thead>
          <tr>
            <td />
            {listings.map((listing) => {
              const listingName = listing.name.trim() || "this stay";

              return (
                <td key={listing.listingId}>
                  <button
                    className="compare-remove"
                    type="button"
                    aria-label={`Remove ${listingName} from compare`}
                    onClick={() => onRemove(listing.listingId)}
                  >
                    Remove from compare
                  </button>
                </td>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {compareFields.map((field) => (
            <tr key={field.id}>
              <th scope="row">{field.label}</th>
              {listings.map((listing) => {
                const cell = field.value(listing);
                const className = cell.unavailable ? "is-unavailable" : undefined;

                if (field.id === "name") {
                  return (
                    <th key={listing.listingId} scope="col" className={className}>
                      {cell.text}
                    </th>
                  );
                }

                return (
                  <td key={listing.listingId} className={className}>
                    {cell.text}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </>
);

const ComparePanel = ({ listings, onRemove, onClear }: ComparePanelProps) => {
  if (listings.length === 0) return null;

  const singleListing = listings.length === 1 ? listings[0] : null;
  const singleName = singleListing ? formatName(singleListing.name) : null;
  const singleNeighbourhood = singleListing
    ? textOrUnavailable(
        singleListing.neighbourhood,
        "Neighbourhood unavailable",
      )
    : null;
  const singlePrice = singleListing ? formatPrice(singleListing.priceCad) : null;

  return (
    <section className="compare-panel" aria-labelledby="compare-heading">
      <div className="compare-panel-header">
        <div>
          <p className="eyebrow">COMPARE</p>
          <div className="compare-heading-row">
            <h3 id="compare-heading">Compare stays</h3>
            <p className="compare-count">
              {listings.length} of {MAX_COMPARED_LISTINGS}
            </p>
          </div>
          <p id="compare-status" className="compare-status" role="status">
            {statusMessage(listings.length)}
          </p>
        </div>
        <button className="compare-clear" type="button" onClick={onClear}>
          Clear comparison
        </button>
      </div>

      {singleListing && singleName && singleNeighbourhood && singlePrice ? (
        <div className="compare-single">
          <div>
            <p
              className={
                singleName.unavailable
                  ? "compare-single-name is-unavailable"
                  : "compare-single-name"
              }
            >
              {singleName.text}
            </p>
            <p className="compare-single-meta">
              <span
                className={
                  singleNeighbourhood.unavailable ? "is-unavailable" : undefined
                }
              >
                {singleNeighbourhood.text}
              </span>
              <span aria-hidden="true"> · </span>
              <span className={singlePrice.unavailable ? "is-unavailable" : undefined}>
                {singlePrice.unavailable
                  ? singlePrice.text
                  : `${singlePrice.text} / night`}
              </span>
            </p>
          </div>
          <button
            className="compare-remove"
            type="button"
            onClick={() => onRemove(singleListing.listingId)}
          >
            Remove from compare
          </button>
        </div>
      ) : (
        <CompareColumns listings={listings} onRemove={onRemove} />
      )}
    </section>
  );
};

export default ComparePanel;
