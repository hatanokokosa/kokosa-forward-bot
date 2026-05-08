import { XMLParser } from "fast-xml-parser";
import { parseApiKeys, summarizeRssItem } from "./ai.ts";
import type { Env, RssFeed, RssItem, TelegramClient } from "./types.ts";

const RSS_FETCH_TIMEOUT_MS = 8000;
const RSS_MAX_FEEDS = 10;
const RSS_SEEN_LIMIT = 50;
const RSS_MAX_ITEMS_PER_REFRESH = 5;
const RSS_LOCK_TTL_SECONDS = 600;

interface ParsedFeed {
  title: string;
  items: RssItem[];
}

export interface RssRefreshResult {
  checked: number;
  sent: number;
  errors: Array<{ id: string; message: string }>;
}

type XmlRecord = Record<string, unknown>;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  textNodeName: "#text",
  trimValues: true,
  parseTagValue: false,
  parseAttributeValue: false,
  removeNSPrefix: true,
});

function asRecord(value: unknown): XmlRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as XmlRecord;
}

function toArray<T>(value: T | T[] | undefined): T[] {
  if (value === undefined) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}

function readText(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") {
    return String(value).trim();
  }

  if (Array.isArray(value)) {
    return readText(value[0]);
  }

  const record = asRecord(value);
  if (!record) {
    return "";
  }

  return readText(record["#text"] ?? record.cdata ?? record.text);
}

function stripHtml(value: string): string {
  return value
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, " ")
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_match, code) =>
      String.fromCharCode(Number.parseInt(code, 10)),
    )
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) =>
      String.fromCharCode(Number.parseInt(code, 16)),
    );
}

function readHtmlAttribute(tag: string, attribute: string): string {
  const pattern = new RegExp(`${attribute}\\s*=\\s*["']([^"']+)["']`, "i");
  return decodeHtmlEntities(tag.match(pattern)?.[1] || "").trim();
}

function extractArticleText(html: string): string {
  const metaTag = html.match(
    /<meta\s+[^>]*(?:name|property)=["'](?:description|og:description|twitter:description)["'][^>]*>/i,
  )?.[0];
  const metaDescription = metaTag ? readHtmlAttribute(metaTag, "content") : "";
  const paragraphs = Array.from(html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi))
    .map((match) => decodeHtmlEntities(stripHtml(match[1])))
    .filter((paragraph) => paragraph.length >= 40)
    .slice(0, 8)
    .join(" ");

  return [metaDescription, paragraphs]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .slice(0, 3000)
    .trim();
}

function normalizeUrl(rawUrl: string): string {
  const url = new URL(rawUrl.trim());
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("RSS URL must start with http:// or https://");
  }

  url.hash = "";
  return url.toString();
}

function resolveUrl(link: string, baseUrl: string): string {
  if (!link) {
    return "";
  }

  try {
    return new URL(link, baseUrl).toString();
  } catch {
    return link;
  }
}

function looksLikeUrl(value: string): boolean {
  return value.startsWith("http://") || value.startsWith("https://");
}

function getAtomLink(entry: XmlRecord, baseUrl: string): string {
  const links = toArray(entry.link);
  const alternate =
    links.find((link) => {
      const record = asRecord(link);
      return record && (!record["@rel"] || record["@rel"] === "alternate");
    }) ?? links[0];

  const record = asRecord(alternate);
  if (record) {
    return resolveUrl(readText(record["@href"]), baseUrl);
  }

  return resolveUrl(readText(alternate), baseUrl);
}

function parseRssItem(itemValue: unknown, baseUrl: string): RssItem | null {
  const item = asRecord(itemValue);
  if (!item) {
    return null;
  }

  const title = readText(item.title) || "(Untitled)";
  const guid = readText(item.guid);
  const rawLink = readText(item.link) || (looksLikeUrl(guid) ? guid : "");
  const link = resolveUrl(rawLink, baseUrl);
  const publishedAt = readText(item.pubDate) || readText(item.published);
  const content =
    readText(item.encoded) ||
    readText(item.description) ||
    readText(item.summary) ||
    readText(item.content);

  if (!link && !guid && !title) {
    return null;
  }

  return {
    title,
    link,
    guid: guid || undefined,
    publishedAt: publishedAt || undefined,
    content: stripHtml(content),
  };
}

function parseAtomItem(entryValue: unknown, baseUrl: string): RssItem | null {
  const entry = asRecord(entryValue);
  if (!entry) {
    return null;
  }

  const title = readText(entry.title) || "(Untitled)";
  const guid = readText(entry.id);
  const rawLink =
    getAtomLink(entry, baseUrl) || (looksLikeUrl(guid) ? guid : "");
  const link = resolveUrl(rawLink, baseUrl);
  const publishedAt = readText(entry.published) || readText(entry.updated);
  const content =
    readText(entry.summary) || readText(entry.content) || readText(entry.title);

  if (!link && !guid && !title) {
    return null;
  }

  return {
    title,
    link,
    guid: guid || undefined,
    publishedAt: publishedAt || undefined,
    content: stripHtml(content),
  };
}

async function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), RSS_FETCH_TIMEOUT_MS);

  try {
    return await fetch(url, {
      headers: {
        accept:
          "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
        "user-agent": "kokosa-forward-bot/1.0",
      },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

async function enrichItemContent(item: RssItem): Promise<RssItem> {
  if (!item.link || (item.content && item.content.length >= 500)) {
    return item;
  }

  try {
    const response = await fetchWithTimeout(item.link);
    const contentType = response.headers.get("content-type") || "";

    if (!response.ok || !contentType.includes("text/html")) {
      return item;
    }

    const html = await response.text();
    const articleText = extractArticleText(html);
    if (!articleText) {
      return item;
    }

    return {
      ...item,
      content: [item.content, articleText].filter(Boolean).join("\n\n"),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`[RSS] Unable to fetch article content: ${message}`);
    return item;
  }
}

async function hashString(value: string): Promise<string> {
  const data = new TextEncoder().encode(value);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function shortHash(value: string, length = 10): Promise<string> {
  return (await hashString(value)).slice(0, length);
}

async function itemKey(item: RssItem): Promise<string> {
  const identity =
    item.guid || item.link || `${item.title}:${item.publishedAt || ""}`;
  return shortHash(identity, 32);
}

function getFeedKey(id: string): string {
  return `rss:feed:${id}`;
}

function getSeenKey(id: string): string {
  return `rss:seen:${id}`;
}

async function getSeenItems(kv: KVNamespace, id: string): Promise<string[]> {
  const seen = await kv.get(getSeenKey(id), { type: "json" });
  return Array.isArray(seen)
    ? seen.filter((item) => typeof item === "string")
    : [];
}

async function putSeenItems(
  kv: KVNamespace,
  id: string,
  seen: string[],
): Promise<void> {
  await kv.put(
    getSeenKey(id),
    JSON.stringify(Array.from(new Set(seen)).slice(0, RSS_SEEN_LIMIT)),
  );
}

export async function getRssFeed(
  kv: KVNamespace,
  id: string,
): Promise<RssFeed | null> {
  const feed = await kv.get(getFeedKey(id), { type: "json" });
  return (feed as RssFeed | null) || null;
}

export async function listRssFeeds(kv: KVNamespace): Promise<RssFeed[]> {
  const list = await kv.list({ prefix: "rss:feed:" });
  const feeds = await Promise.all(
    list.keys.map((key) => kv.get(key.name, { type: "json" })),
  );

  return (feeds.filter(Boolean) as RssFeed[]).sort(
    (left, right) => left.createdAt - right.createdAt,
  );
}

export async function fetchAndParseFeed(url: string): Promise<ParsedFeed> {
  const normalizedUrl = normalizeUrl(url);
  const response = await fetchWithTimeout(normalizedUrl);

  if (!response.ok) {
    throw new Error(`RSS fetch failed with HTTP ${response.status}`);
  }

  const xml = await response.text();
  const parsed = parser.parse(xml) as XmlRecord;
  const rss = asRecord(parsed.rss);
  const atom = asRecord(parsed.feed);

  if (rss) {
    const channel = asRecord(rss.channel);
    if (!channel) {
      throw new Error("RSS channel not found");
    }

    const title = readText(channel.title) || new URL(normalizedUrl).hostname;
    const items = toArray(channel.item)
      .map((item) => parseRssItem(item, normalizedUrl))
      .filter(Boolean) as RssItem[];

    return { title, items };
  }

  if (atom) {
    const title = readText(atom.title) || new URL(normalizedUrl).hostname;
    const items = toArray(atom.entry)
      .map((entry) => parseAtomItem(entry, normalizedUrl))
      .filter(Boolean) as RssItem[];

    return { title, items };
  }

  throw new Error("Unsupported RSS/Atom feed format");
}

export async function addRssFeed(
  kv: KVNamespace,
  rawUrl: string,
  titleOverride?: string,
): Promise<{ feed: RssFeed; initialItems: number }> {
  const url = normalizeUrl(rawUrl);
  const feeds = await listRssFeeds(kv);
  const existing = feeds.find((feed) => feed.url === url);

  if (existing) {
    throw new Error(`Feed already exists: ${existing.id}`);
  }

  if (feeds.length >= RSS_MAX_FEEDS) {
    throw new Error(`RSS feed limit reached (${RSS_MAX_FEEDS})`);
  }

  const parsed = await fetchAndParseFeed(url);
  const now = Date.now();
  const feed: RssFeed = {
    id: await shortHash(url),
    url,
    title: titleOverride?.trim() || parsed.title,
    sourceTitle: parsed.title,
    enabled: true,
    createdAt: now,
    updatedAt: now,
    lastCheckedAt: now,
  };

  const seen = await Promise.all(
    parsed.items.slice(0, RSS_SEEN_LIMIT).map((item) => itemKey(item)),
  );

  await kv.put(getFeedKey(feed.id), JSON.stringify(feed));
  await putSeenItems(kv, feed.id, seen);

  return { feed, initialItems: parsed.items.length };
}

export async function removeRssFeed(
  kv: KVNamespace,
  id: string,
): Promise<boolean> {
  const feed = await getRssFeed(kv, id);
  if (!feed) {
    return false;
  }

  await kv.delete(getFeedKey(id));
  await kv.delete(getSeenKey(id));
  return true;
}

export async function updateRssFeedTitle(
  kv: KVNamespace,
  id: string,
  title: string,
): Promise<RssFeed | null> {
  const feed = await getRssFeed(kv, id);
  if (!feed) {
    return null;
  }

  feed.title = title.trim();
  feed.updatedAt = Date.now();
  await kv.put(getFeedKey(id), JSON.stringify(feed));
  return feed;
}

async function sendRssNotification(
  telegram: TelegramClient,
  adminId: string,
  feed: RssFeed,
  item: RssItem,
  summary: string,
): Promise<boolean> {
  const link = item.link || feed.url;
  const result = await telegram.sendMessage({
    chat_id: adminId,
    text: `[RSS] ${feed.title}\n\n${item.title}\n${link}\n\nSummary: ${summary}`,
  });

  if (!result.ok) {
    console.error(`[RSS] Telegram send failed for ${feed.id}`);
    return false;
  }

  return true;
}

async function refreshOneFeed(
  kv: KVNamespace,
  telegram: TelegramClient,
  env: Env,
  feed: RssFeed,
): Promise<{ sent: number; error?: string }> {
  try {
    const parsed = await fetchAndParseFeed(feed.url);
    const previousSeen = await getSeenItems(kv, feed.id);
    const previousSeenSet = new Set(previousSeen);
    const itemsWithKeys = await Promise.all(
      parsed.items.map(async (item) => ({ item, key: await itemKey(item) })),
    );

    const newItems = itemsWithKeys
      .filter(({ key }) => !previousSeenSet.has(key))
      .slice(0, RSS_MAX_ITEMS_PER_REFRESH)
      .reverse();

    let sent = 0;
    const sentKeys: string[] = [];
    const apiKeys = parseApiKeys(env.ENV_GEMINI_API_KEY);

    for (const { item, key } of newItems) {
      const summaryItem = apiKeys ? await enrichItemContent(item) : item;
      const summary = await summarizeRssItem(summaryItem, apiKeys);
      const delivered = await sendRssNotification(
        telegram,
        env.ENV_ADMIN_UID,
        feed,
        item,
        summary,
      );

      if (delivered) {
        sent += 1;
        sentKeys.push(key);
      }
    }

    const alreadySeenCurrentKeys = itemsWithKeys
      .map(({ key }) => key)
      .filter((key) => previousSeenSet.has(key));
    const nextSeen = [...sentKeys, ...alreadySeenCurrentKeys, ...previousSeen];
    const nextFeed: RssFeed = {
      ...feed,
      sourceTitle: parsed.title,
      lastCheckedAt: Date.now(),
      updatedAt: Date.now(),
      lastError: undefined,
    };

    await kv.put(getFeedKey(feed.id), JSON.stringify(nextFeed));
    await putSeenItems(kv, feed.id, nextSeen);

    return { sent };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const nextFeed: RssFeed = {
      ...feed,
      lastCheckedAt: Date.now(),
      updatedAt: Date.now(),
      lastError: message,
    };

    await kv.put(getFeedKey(feed.id), JSON.stringify(nextFeed));
    return { sent: 0, error: message };
  }
}

async function acquireRssLock(kv: KVNamespace): Promise<boolean> {
  const lock = await kv.get("rss:lock", { type: "text" });
  if (lock) {
    return false;
  }

  await kv.put("rss:lock", String(Date.now()), {
    expirationTtl: RSS_LOCK_TTL_SECONDS,
  });
  return true;
}

async function releaseRssLock(kv: KVNamespace): Promise<void> {
  await kv.delete("rss:lock");
}

export async function refreshRssFeeds(
  kv: KVNamespace,
  telegram: TelegramClient,
  env: Env,
  feedId?: string,
): Promise<RssRefreshResult> {
  const lockAcquired = await acquireRssLock(kv);
  if (!lockAcquired) {
    return {
      checked: 0,
      sent: 0,
      errors: [{ id: "lock", message: "RSS refresh is already running" }],
    };
  }

  try {
    const feeds = feedId
      ? [await getRssFeed(kv, feedId)]
      : await listRssFeeds(kv);
    const enabledFeeds = feeds.filter((feed): feed is RssFeed =>
      Boolean(feed?.enabled),
    );
    const result: RssRefreshResult = { checked: 0, sent: 0, errors: [] };

    for (const feed of enabledFeeds) {
      result.checked += 1;
      const feedResult = await refreshOneFeed(kv, telegram, env, feed);
      result.sent += feedResult.sent;

      if (feedResult.error) {
        result.errors.push({ id: feed.id, message: feedResult.error });
      }
    }

    if (feedId && enabledFeeds.length === 0) {
      result.errors.push({ id: feedId, message: "RSS feed not found" });
    }

    return result;
  } finally {
    await releaseRssLock(kv);
  }
}
