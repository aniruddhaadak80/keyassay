import type {
  CitationRecord,
  CitationVerification,
  LivePayload,
  SourceMeta,
  SourceStatus,
} from "../types";
import { GIDNEY_2025_ARXIV, GIDNEY_2025_TITLE, GIDNEY_EKERA_ARXIV, GIDNEY_EKERA_TITLE } from "../engine/constants";

/**
 * Live source 3: arXiv.
 *
 * The engine's quantum break costs come from two specific papers. Rather than
 * hard-coding those citations as uncheckable strings, this module fetches their
 * real metadata from the arXiv API and reports whether the paper the engine
 * cites is still the paper arXiv says it is.
 *
 * That is what makes the cost model auditable rather than folklore: if either
 * citation is wrong or superseded, /standards says so.
 */

const ARXIV_TIMEOUT_MS = 6_000;
const ARXIV_ENDPOINT = "http://export.arxiv.org/api/query";

/**
 * arXiv is a free service that rate-limits by IP, and it does so lazily: a
 * rejected request can hang for half a minute before the 429 arrives. That
 * shapes this module in three ways.
 *
 * 1. Short abort. Six seconds is long enough for a healthy response and short
 *    enough that a page never visibly waits on a throttled upstream.
 * 2. No retry on a rate limit. Retrying a 429 is impolite and, given the slow
 *    rejection, would double the wait for no gain.
 * 3. A long in-process cache. Citation metadata is reference data that changes
 *    on the order of months, so a successful verification is memoised and reused
 *    rather than re-asked for on every page view.
 *
 * When arXiv is unreachable the caller gets an explicit "fallback with a reason".
 * It never gets a stale match presented as a current verification.
 */
const ARXIV_REVALIDATE_SECONDS = 21_600;
const CITATION_MEMO_TTL_MS = 6 * 60 * 60 * 1000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchArxiv(
  url: string,
  signal: AbortSignal,
): Promise<{ ok: boolean; status: number; body: string; reason: string | null }> {
  const response = await fetch(url, {
    signal,
    headers: {
      accept: "application/atom+xml",
      "user-agent": "keyassay/1.0 (+https://github.com/aniruddhaadak80/keyassay)",
    },
    next: { revalidate: ARXIV_REVALIDATE_SECONDS },
  } as RequestInit);

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      body: "",
      reason:
        response.status === 429
          ? "arXiv rate-limited this request (HTTP 429); citation shown as unverified rather than assumed correct"
          : `arXiv returned HTTP ${response.status}`,
    };
  }

  return { ok: true, status: response.status, body: await response.text(), reason: null };
}

interface ArxivEntry {
  id?: string;
  title?: string;
  published?: string;
  updated?: string;
  summary?: string;
  author?: Array<{ name?: string }> | { name?: string };
}

function normaliseTitle(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function isTitleMatch(remote: string, local: string): boolean {
  const a = normaliseTitle(remote);
  const b = normaliseTitle(local);
  if (a === b) return true;
  // arXiv occasionally capitalises "RSA" differently; compare on a sorted token
  // basis so a genuine change of paper still fails the check.
  const tokensA = [...a.split(" ")].sort().join(" ");
  const tokensB = [...b.split(" ")].sort().join(" ");
  return tokensA === tokensB;
}

function entryAuthors(entry: ArxivEntry): string[] {
  const raw = entry.author;
  if (!raw) return [];
  const list = Array.isArray(raw) ? raw : [raw];
  return list
    .map((author) => (author?.name ?? "").trim())
    .filter((name) => name.length > 0 && name.length <= 120)
    .slice(0, 12);
}

async function fetchEntries(ids: string[]): Promise<ArxivEntry[]> {
  const url = `${ARXIV_ENDPOINT}?id_list=${encodeURIComponent(ids.join(","))}&max_results=${ids.length}`;

  let lastReason = "arXiv request failed";
  // At most two attempts, and the second is only for a transport failure. A
  // deliberate 429 or 503 is returned as-is: arXiv is telling us to stop.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ARXIV_TIMEOUT_MS);
    try {
      const result = await fetchArxiv(url, controller.signal);
      if (result.ok) {
        return parseEntries(result.body);
      }
      lastReason = result.reason ?? lastReason;
      if (attempt === 0 && result.status !== 429 && result.status !== 503) {
        await sleep(750);
      } else {
        break;
      }
    } catch (error) {
      lastReason =
        error instanceof Error && error.name === "AbortError"
          ? `arXiv did not respond within ${ARXIV_TIMEOUT_MS / 1000} seconds`
          : error instanceof Error
            ? error.message
            : "arXiv request failed";
      if (attempt === 0) await sleep(750);
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(lastReason);
}

function parseEntries(xml: string): ArxivEntry[] {
  const entries: ArxivEntry[] = [];
  const matches = xml.match(/<entry>[\s\S]*?<\/entry>/g) ?? [];
  for (const block of matches) {
    const pick = (tag: string): string | undefined => {
      const found = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
      return found?.[1]?.trim();
    };
    const id = pick("id");
    const title = pick("title");
    if (!id || !title) continue;
    const authorBlocks = block.match(/<author>[\s\S]*?<\/author>/g) ?? [];
    entries.push({
      id,
      title,
      published: pick("published"),
      updated: pick("updated"),
      summary: pick("summary"),
      author: authorBlocks.map((authorBlock) => ({
        name: authorBlock.match(/<name>([\s\S]*?)<\/name>/)?.[1]?.trim() ?? "",
      })),
    });
  }
  return entries;
}

export interface VerifyCitationInput {
  arxivId: string;
  expectedTitle: string;
}

/**
 * Verify one citation against arXiv. Never throws: a network failure is reported
 * as an unverified citation with a reason, never as a thrown error that would
 * take down the page.
 */
export async function verifyCitation(input: VerifyCitationInput): Promise<CitationVerification> {
  const checkedAt = new Date().toISOString();
  const expectedId = input.arxivId.replace(/^arXiv:/i, "");

  let entries: ArxivEntry[];
  try {
    entries = await fetchEntries([expectedId]);
  } catch (error) {
    return {
      arxivId: expectedId,
      status: "fallback",
      found: false,
      title: null,
      published: null,
      updated: null,
      authors: [],
      url: `https://arxiv.org/abs/${expectedId}`,
      titleMatches: false,
      checkedAt,
      reason: error instanceof Error ? error.message : "arXiv lookup failed",
    };
  }

  const match = entries.find((entry) => (entry.id ?? "").includes(expectedId));
  if (!match?.title) {
    return {
      arxivId: expectedId,
      status: "live",
      found: false,
      title: null,
      published: null,
      updated: null,
      authors: [],
      url: `https://arxiv.org/abs/${expectedId}`,
      titleMatches: false,
      checkedAt,
      reason: "arXiv returned no entry for this identifier",
    };
  }

  const title = (match.title ?? "").replace(/\s+/g, " ").trim();
  return {
    arxivId: expectedId,
    status: "live",
    found: true,
    title,
    published: match.published ?? null,
    updated: match.updated ?? null,
    authors: entryAuthors(match),
    url: `https://arxiv.org/abs/${expectedId}`,
    titleMatches: isTitleMatch(title, input.expectedTitle),
    checkedAt,
  };
}

/** Verify both papers the engine depends on. */
let citationMemo: { at: number; value: CitationVerification[] } | null = null;

export async function verifyEngineCitations(): Promise<CitationVerification[]> {
  const now = Date.now();
  if (citationMemo && now - citationMemo.at < CITATION_MEMO_TTL_MS) {
    return citationMemo.value;
  }

  const results = await Promise.all([
    verifyCitation({ arxivId: GIDNEY_EKERA_ARXIV, expectedTitle: GIDNEY_EKERA_TITLE }),
    verifyCitation({ arxivId: GIDNEY_2025_ARXIV, expectedTitle: GIDNEY_2025_TITLE }),
  ]);

  // Only a fully successful verification is worth remembering. A throttled
  // result must be retried on the next request rather than pinned for hours.
  if (results.every((entry) => entry.status === "live" && entry.found)) {
    citationMemo = { at: now, value: results };
  }

  return results;
}

/** Test seam: forget the memoised citation verification. */
export function resetCitationMemo(): void {
  citationMemo = null;
}

export interface ResearchSignal {
  id: string;
  title: string;
  summary: string;
  published: string;
  authors: string[];
  url: string;
  categories: string[];
}

/**
 * Recent post-quantum cryptography research from arXiv quant-ph and cs.CR.
 *
 * Shown on the landing page and Standards route so the reader can see what the
 * literature is currently claiming, with attribution, instead of trusting a
 * single stale figure.
 */
export async function fetchResearchSignals(limit = 6): Promise<LivePayload<ResearchSignal[]>> {
  const fetchedAt = new Date().toISOString();
  const query = '(cat:quant-ph OR cat:cs.CR) AND (abs:"post-quantum" OR abs:"quantum-vulnerable" OR abs:"cryptographically relevant quantum")';
  const url = `${ARXIV_ENDPOINT}?search_query=${encodeURIComponent(query)}&sortBy=submittedDate&sortOrder=descending&max_results=${limit}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ARXIV_TIMEOUT_MS);
  const meta = (status: SourceStatus, reason?: string): SourceMeta => ({
    status,
    source: status === "live" ? "arXiv API" : "Sealed offline sample",
    upstreamId: status === "live" ? "quant-ph + cs.CR" : "sealed-sample/research",
    attribution:
      status === "live"
        ? `Recent arXiv submissions in quant-ph and cs.CR mentioning post-quantum cryptography, retrieved at ${fetchedAt}.`
        : "Sealed offline sample. arXiv could not be reached, so no current research listing is shown.",
    fetchedAt,
    ...(reason ? { fallbackReason: reason } : {}),
  });

  try {
    const response = await fetchArxiv(url, controller.signal);
    if (!response.ok) {
      return { status: "fallback", meta: meta("fallback", response.reason ?? "arXiv unavailable"), data: [] };
    }

    const xml = response.body;
    const signals: ResearchSignal[] = [];
    const blocks = xml.match(/<entry>[\s\S]*?<\/entry>/g) ?? [];
    for (const block of blocks) {
      const pick = (tag: string): string | undefined => {
        const found = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
        return found?.[1]?.trim();
      };
      const id = pick("id");
      const title = pick("title")?.replace(/\s+/g, " ").trim();
      if (!id || !title) continue;
      const authors = (block.match(/<author>[\s\S]*?<\/author>/g) ?? [])
        .map((authorBlock) => authorBlock.match(/<name>([\s\S]*?)<\/name>/)?.[1]?.trim() ?? "")
        .filter((name) => name.length > 0)
        .slice(0, 5);
      const categories = [...block.matchAll(/<category[^>]*term="([^"]+)"/g)]
        .map((match) => match[1] ?? "")
        .filter((term) => term.length > 0)
        .slice(0, 4);
      signals.push({
        id: id.replace("http://arxiv.org/abs/", ""),
        title,
        summary: (pick("summary") ?? "").replace(/\s+/g, " ").trim().slice(0, 600),
        published: pick("published") ?? "",
        authors,
        url: id,
        categories,
      });
      if (signals.length >= limit) break;
    }

    return { status: "live", meta: meta("live"), data: signals };
  } catch (error) {
    const reason =
      error instanceof Error && error.name === "AbortError"
        ? `arXiv did not respond within ${ARXIV_TIMEOUT_MS / 1000} seconds`
        : error instanceof Error
          ? error.message
          : "arXiv request failed";
    return { status: "fallback", meta: meta("fallback", reason), data: [] };
  } finally {
    clearTimeout(timer);
  }
}

/** Parse the Atom feed into full citation records (used by the method page). */
export async function fetchCitationRecords(ids: string[]): Promise<CitationRecord[]> {
  const entries = await fetchEntries(ids);
  return entries.map((entry) => {
    const id = (entry.id ?? "").replace("http://arxiv.org/abs/", "");
    const summary = (entry.summary ?? "").replace(/\s+/g, " ").trim();
    return {
      arxivId: id,
      title: (entry.title ?? "").replace(/\s+/g, " ").trim(),
      published: entry.published ?? "",
      updated: entry.updated ?? "",
      authors: entryAuthors(entry),
      abstract: summary.slice(0, 1200),
      url: `https://arxiv.org/abs/${id}`,
    };
  });
}