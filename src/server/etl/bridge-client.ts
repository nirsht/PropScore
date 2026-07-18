import { env } from "@/lib/env";

/**
 * Typed Bridge OData client.
 *
 * Docs: https://bridgedataoutput.com/docs/platform/API/reso-web-api
 *
 * Auth:    server token sent as `Bearer <token>`
 * Limits:  5000 req/hr, burst ~334 req/min — enforced via token-bucket throttle.
 * Paging:  `$top=200` (max), `$skip` for offset; switch to `/replication` for >10k rows.
 */

const PAGE_SIZE = 200;
const THROTTLE_MIN_INTERVAL_MS = 200; // ~300 req/min — comfortably below the burst limit
const MAX_RETRIES = 5;

export type BridgeProperty = Record<string, unknown> & {
  ListingKey?: string;
  ListingId?: string;
  StandardStatus?: string;
  ListPrice?: number;
  DaysOnMarket?: number;
  ListingContractDate?: string;
  ModificationTimestamp?: string;
  BridgeModificationTimestamp?: string;
  PropertyType?: string;
  PropertySubType?: string;
  LivingArea?: number;
  BuildingAreaTotal?: number;
  NumberOfUnitsTotal?: number;
  BedroomsTotal?: number;
  BathroomsTotalInteger?: number;
  BathroomsTotalDecimal?: number;
  YearBuilt?: number;
  StoriesTotal?: number;
  Stories?: number;
  LotSizeSquareFeet?: number;
  LotSizeAcres?: number;
  LotSizeArea?: number;
  LotSizeUnits?: string;
  LotFeatures?: string[];
  ParkingTotal?: number;
  View?: string[];
  AssociationFee?: number;
  AssociationFeeFrequency?: string;
  TaxAnnualAmount?: number;
  TaxYear?: number;
  PreviousListPrice?: number;
  Latitude?: number;
  Longitude?: number;
  UnparsedAddress?: string;
  StreetNumber?: string | number;
  StreetName?: string;
  City?: string;
  StateOrProvince?: string;
  PostalCode?: string;
  PublicRemarks?: string;
  PrivateRemarks?: string;
  ListAgentFullName?: string;
  ListAgentMlsId?: string;
  ListAgentKey?: string;
  ListOfficeName?: string;
  ListOfficeMlsId?: string;
  CoListAgentFullName?: string;
  // RESO auction fields. SpecialListingConditions and ListingTerms are
  // multi-valued enums; Bridge may serialize them as a JSON array or a
  // comma-delimited string depending on the dataset/version.
  SpecialListingConditions?: string[] | string;
  ListingTerms?: string[] | string;
  AuctionDate?: string;
};

export type SearchOptions = {
  /** OData $filter clause. Combine with `and` server-side. */
  filter?: string;
  /** Override fields. Defaults to a curated multi-family-friendly subset. */
  select?: string[];
  /** Order-by clause; defaults to BridgeModificationTimestamp asc for stable paging. */
  orderby?: string;
  /** Hard cap on total rows returned (safety net). 0 = no cap. */
  maxRows?: number;
};

export type SearchResult = {
  fetched: number;
  records: BridgeProperty[];
};

const DEFAULT_SELECT = [
  "ListingKey",
  "ListingId",
  "StandardStatus",
  "ListPrice",
  "DaysOnMarket",
  "ListingContractDate",
  "ModificationTimestamp",
  "BridgeModificationTimestamp",
  "PropertyType",
  "PropertySubType",
  "LivingArea",
  "BuildingAreaTotal",
  // Lot — needed for buildings where the MLS doesn't populate building sqft
  // but does populate the parcel; matches what Zillow falls back to.
  "LotSizeArea",
  "LotSizeUnits",
  "LotSizeSquareFeet",
  "LotSizeAcres",
  "LotFeatures",
  "NumberOfUnitsTotal",
  "BedroomsTotal",
  "BathroomsTotalInteger",
  "YearBuilt",
  "StoriesTotal",
  "Stories",
  "ParkingTotal",
  "View",
  "AssociationFee",
  "AssociationFeeFrequency",
  "TaxAnnualAmount",
  "Latitude",
  "Longitude",
  "UnparsedAddress",
  "StreetNumber",
  "StreetName",
  "City",
  "StateOrProvince",
  "PostalCode",
  "PublicRemarks",
  // Listing agent + brokerage names. Bridge's sfar dataset doesn't permit
  // selecting agent phone/email off the Property under IDX policy, so we only
  // pull the names + ids here. The agent's real phone/email IS available on the
  // separate /Member resource, keyed on ListAgentKey/ListAgentMlsId — see
  // fetchMember() and the contact-enrichment chain.
  "ListAgentFullName",
  "ListAgentMlsId",
  "ListAgentKey",
  "ListOfficeName",
  "ListOfficeMlsId",
  "CoListAgentFullName",
  // Auction signals — Bridge `sfar` no longer permits selecting ListingTerms
  // or AuctionDate under IDX policy (rejected with 400 as of 2026-05). The
  // normalize layer falls back to SpecialListingConditions alone.
  "SpecialListingConditions",
];

let lastRequestAt = 0;

async function throttle() {
  const now = Date.now();
  const wait = Math.max(0, lastRequestAt + THROTTLE_MIN_INTERVAL_MS - now);
  lastRequestAt = now + wait;
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}

async function request<T>(url: string, attempt = 0): Promise<T> {
  await throttle();

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${env.BRIDGE_SERVER_TOKEN}`,
      Accept: "application/json",
    },
  });

  // AWS WAF in front of Bridge sometimes responds with HTTP 202 + an empty
  // body and `x-amzn-waf-action: challenge` when the client looks bot-like
  // (server-to-server, no JS challenge support). Detect this explicitly —
  // otherwise the `await res.json()` below throws an opaque
  // `SyntaxError: Unexpected end of JSON input`. Retry like a 429; if WAF
  // keeps challenging, surface a clear error so the caller knows it's a
  // WAF block, not a transient parse issue.
  const wafAction = res.headers.get("x-amzn-waf-action");
  if (wafAction === "challenge") {
    if (attempt >= MAX_RETRIES) {
      throw new Error(
        `Bridge WAF challenge after ${attempt} retries (x-amzn-waf-action=challenge). Likely IP-rate-limited by Bridge/CloudFront.`,
      );
    }
    const delay = Math.min(30_000, 2 ** attempt * 1000);
    await new Promise((r) => setTimeout(r, delay));
    return request<T>(url, attempt + 1);
  }

  if (res.status === 429 || (res.status >= 500 && res.status < 600)) {
    if (attempt >= MAX_RETRIES) {
      throw new Error(`Bridge ${res.status} after ${attempt} retries: ${await res.text()}`);
    }
    const retryAfter = Number(res.headers.get("Retry-After"));
    const delay = Number.isFinite(retryAfter) && retryAfter > 0
      ? retryAfter * 1000
      : Math.min(30_000, 2 ** attempt * 500);
    await new Promise((r) => setTimeout(r, delay));
    return request<T>(url, attempt + 1);
  }

  if (!res.ok) {
    throw new Error(`Bridge ${res.status} ${res.statusText}: ${await res.text()}`);
  }

  return (await res.json()) as T;
}

function buildUrl(opts: SearchOptions, skip: number): string {
  const params = new URLSearchParams();
  params.set("access_token", env.BRIDGE_SERVER_TOKEN);
  params.set("$top", String(PAGE_SIZE));
  params.set("$skip", String(skip));
  if (opts.filter) params.set("$filter", opts.filter);
  params.set("$orderby", opts.orderby ?? "BridgeModificationTimestamp asc");
  params.set("$select", (opts.select ?? DEFAULT_SELECT).join(","));

  const base = `${env.BRIDGE_BASE_URL}/${env.BRIDGE_DATASET}/Properties`;
  return `${base}?${params.toString()}`;
}

/**
 * Iterate every page satisfying `opts.filter`, yielding records as they arrive.
 * Caller is responsible for batching upserts.
 */
export async function* searchProperties(opts: SearchOptions = {}): AsyncIterable<BridgeProperty> {
  let skip = 0;
  let yielded = 0;

  while (true) {
    type Page = { value: BridgeProperty[]; "@odata.nextLink"?: string };
    const url = buildUrl(opts, skip);
    const page = await request<Page>(url);

    for (const row of page.value) {
      yield row;
      yielded += 1;
      if (opts.maxRows && yielded >= opts.maxRows) return;
    }

    if (page.value.length < PAGE_SIZE) return;
    skip += PAGE_SIZE;
  }
}

/**
 * Convenience: fully drain the iterator into memory. Avoid for large pulls.
 */
export async function searchAll(opts: SearchOptions = {}): Promise<SearchResult> {
  const records: BridgeProperty[] = [];
  for await (const row of searchProperties(opts)) records.push(row);
  return { fetched: records.length, records };
}

export type BridgeMediaItem = {
  MediaURL?: string;
  MediaCategory?: string;
  Order?: number;
  ShortDescription?: string;
  LongDescription?: string;
  ImageWidth?: number;
  ImageHeight?: number;
  // Catch-all for any extra fields a given dataset surfaces.
  [key: string]: unknown;
};

export type MediaFetchResult = {
  items: BridgeMediaItem[];
  via: string;
  attempts: Array<{ via: string; ok: boolean; count: number; error?: string }>;
};

/**
 * Fetch photos for one listing.
 *
 * In Bridge's `sfar` schema, photos are NOT a separate `/Media` resource and
 * NOT exposed via `$expand=Media`. They live as an inline collection on the
 * Property record itself, retrieved by `$select=Media` (a Collection of
 * `PropertyComplexTypes.Media`). We've also got `PrivateMedia` and
 * `VirtualTourURLUnbranded` which we surface alongside.
 *
 * We probe by `ListingKey` first (the actual primary key — a hash like
 * `68177f07...`) and fall back to `ListingId` (the human MLS number) since
 * different rows in our DB can be keyed either way depending on how Bridge
 * surfaced them.
 */
export async function fetchListingMedia(mlsId: string): Promise<MediaFetchResult> {
  const escaped = mlsId.replace(/'/g, "''");
  const base = `${env.BRIDGE_BASE_URL}/${env.BRIDGE_DATASET}`;
  const select = "Media,PrivateMedia,VirtualTourURLUnbranded,PhotosCount";

  const strategies: Array<{ via: string; url: string }> = [
    {
      via: "Property+select=Media+ListingKey",
      url: `${base}/Property?$filter=${encodeURIComponent(
        `ListingKey eq '${escaped}'`,
      )}&$top=1&$select=${encodeURIComponent(select)}&access_token=${env.BRIDGE_SERVER_TOKEN}`,
    },
    {
      via: "Property+select=Media+ListingId",
      url: `${base}/Property?$filter=${encodeURIComponent(
        `ListingId eq '${escaped}'`,
      )}&$top=1&$select=${encodeURIComponent(select)}&access_token=${env.BRIDGE_SERVER_TOKEN}`,
    },
    {
      via: "Properties+select=Media+ListingKey",
      url: `${base}/Properties?$filter=${encodeURIComponent(
        `ListingKey eq '${escaped}'`,
      )}&$top=1&$select=${encodeURIComponent(select)}&access_token=${env.BRIDGE_SERVER_TOKEN}`,
    },
  ];

  const attempts: MediaFetchResult["attempts"] = [];

  for (const s of strategies) {
    try {
      const raw = await request<{
        value?: Array<{ Media?: BridgeMediaItem[]; PhotosCount?: number }>;
      }>(s.url);

      const record = raw.value?.[0];
      const items = (record?.Media ?? [])
        .filter((m) => typeof m.MediaURL === "string" && m.MediaURL.length)
        .sort((a, b) => (a.Order ?? 0) - (b.Order ?? 0));

      attempts.push({ via: s.via, ok: true, count: items.length });

      if (items.length > 0) {
        // eslint-disable-next-line no-console
        console.log(
          `[bridge:media] mlsId=${mlsId} via=${s.via} count=${items.length} (PhotosCount=${record?.PhotosCount ?? "?"})`,
        );
        return { items, via: s.via, attempts };
      }
    } catch (err) {
      attempts.push({
        via: s.via,
        ok: false,
        count: 0,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // eslint-disable-next-line no-console
  console.warn(
    `[bridge:media] mlsId=${mlsId} no media found via ${strategies.length} strategies. Attempts:`,
    attempts,
  );
  return { items: [], via: "none", attempts };
}

export type BridgeMember = Record<string, unknown> & {
  MemberKey?: string;
  MemberMlsId?: string;
  MemberFullName?: string;
  MemberFirstName?: string;
  MemberLastName?: string;
  MemberPreferredPhone?: string | null;
  MemberDirectPhone?: string | null;
  MemberMobilePhone?: string | null;
  MemberOfficePhone?: string | null;
  MemberEmail?: string | null;
  MemberStateLicense?: string | null;
  /** SFAR-specific: extension that applies to the office landline. */
  SFAR_PhoneExtension?: string | null;
  OfficeName?: string | null;
  OfficeMlsId?: string | null;
};

const MEMBER_SELECT = [
  "MemberKey",
  "MemberMlsId",
  "MemberFullName",
  "MemberFirstName",
  "MemberLastName",
  "MemberPreferredPhone",
  "MemberDirectPhone",
  "MemberMobilePhone",
  "MemberOfficePhone",
  "MemberEmail",
  "MemberStateLicense",
  "SFAR_PhoneExtension",
  "OfficeName",
  "OfficeMlsId",
];

/**
 * Look up one agent on Bridge's `/Member` resource by their MLS member id.
 *
 * Unlike the Property payload — where `sfar` IDX policy strips agent
 * phone/email — the Member resource returns the agent's real direct/office
 * phone and email. Because we match on the agent's own id (`ListAgentKey`, the
 * exact PK hash, preferred; else `ListAgentMlsId`), there's no name-collision
 * risk: we get the phone/email of *this* listing's agent, never a different
 * same-named agent.
 *
 * Returns the first match, or null when neither id is provided / nothing
 * matches. Throws only on a hard transport error (same retry policy as the
 * Property client); callers in the contact chain treat that as "step found
 * nothing" and move on.
 */
export async function fetchMember(params: {
  memberKey?: string | null;
  memberMlsId?: string | null;
}): Promise<BridgeMember | null> {
  const escape = (v: string) => v.replace(/'/g, "''");
  const clause = params.memberKey
    ? `MemberKey eq '${escape(params.memberKey)}'`
    : params.memberMlsId
      ? `MemberMlsId eq '${escape(params.memberMlsId)}'`
      : null;
  if (!clause) return null;

  const p = new URLSearchParams();
  p.set("access_token", env.BRIDGE_SERVER_TOKEN);
  p.set("$filter", clause);
  p.set("$select", MEMBER_SELECT.join(","));
  p.set("$top", "1");

  const url = `${env.BRIDGE_BASE_URL}/${env.BRIDGE_DATASET}/Member?${p.toString()}`;
  const page = await request<{ value?: BridgeMember[] }>(url);
  return page.value?.[0] ?? null;
}

/**
 * Fetch the OData metadata document — used by scripts/bootstrap-bridge.ts to
 * verify auth and discover available fields.
 */
export async function fetchMetadata(): Promise<string> {
  await throttle();
  const url = `${env.BRIDGE_BASE_URL}/${env.BRIDGE_DATASET}/$metadata`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${env.BRIDGE_SERVER_TOKEN}` },
  });
  if (!res.ok) throw new Error(`Bridge metadata ${res.status}: ${await res.text()}`);
  return res.text();
}

/**
 * Quote an ISO timestamp for OData filter use.
 */
export function odataDateTime(d: Date): string {
  return d.toISOString();
}
