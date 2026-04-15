import {
  MOD_CACHE_MIN_LENGTH,
  MOD_CACHE_TTL_SECONDS,
  RATE_LIMIT_MAX_REQUESTS,
  RATE_LIMIT_TTL_SECONDS,
  RATE_LIMIT_WINDOW_MS,
  TRUST_THRESHOLD,
} from "./config.ts";
import type {
  BlockInfo,
  CachedModerationResult,
  RateLimitRecord,
  RateLimitResult,
  RelayMessageType,
  RelayRecord,
  RelayStatus,
  Statistics,
  TelegramMessage,
} from "./types.ts";

function generateRelayId(): string {
  return `R-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
}

function getMessageType(message: TelegramMessage): RelayMessageType {
  if (message.text) return "text";
  if (message.photo) return "photo";
  return "other";
}

function parseInteger(value: string | null): number {
  return Number.parseInt(value || "0", 10);
}

export async function createRelay(
  kv: KVNamespace,
  guestId: string,
  message: TelegramMessage,
): Promise<RelayRecord> {
  const relay: RelayRecord = {
    id: generateRelayId(),
    guestId,
    guestUsername:
      message.from?.username || message.from?.first_name || "Unknown",
    status: "open",
    createdAt: Date.now(),
    messageType: getMessageType(message),
    preview: (message.text || message.caption || "").substring(0, 100),
  };

  await kv.put(`relay:${relay.id}`, JSON.stringify(relay));
  await kv.put(`guest:latest:${guestId}`, relay.id);
  await incrementCounter(kv, "total-relays");

  return relay;
}

export async function getRelay(
  kv: KVNamespace,
  relayId: string,
): Promise<RelayRecord | null> {
  const data = await kv.get(`relay:${relayId}`, { type: "json" });
  return (data as RelayRecord | null) || null;
}

export async function updateRelayStatus(
  kv: KVNamespace,
  relayId: string,
  status: RelayStatus,
): Promise<void> {
  const relay = await getRelay(kv, relayId);
  if (!relay) {
    return;
  }

  relay.status = status;
  relay.updatedAt = Date.now();
  await kv.put(`relay:${relayId}`, JSON.stringify(relay));
}

export async function linkAdminMessage(
  kv: KVNamespace,
  adminMsgId: number,
  relayId: string,
): Promise<void> {
  await kv.put(`admin-msg:${adminMsgId}`, relayId);
}

export async function getRelayByAdminMsg(
  kv: KVNamespace,
  adminMsgId: number,
): Promise<string | null> {
  return kv.get(`admin-msg:${adminMsgId}`, { type: "text" });
}

export async function isGuestBlocked(
  kv: KVNamespace,
  guestId: string,
): Promise<boolean> {
  const status = await kv.get(`blocked:${guestId}`, { type: "text" });
  return status === "true";
}

export async function setGuestBlocked(
  kv: KVNamespace,
  guestId: string,
  blocked: boolean,
  reason = "Manual",
): Promise<void> {
  if (blocked) {
    const blockData: BlockInfo = { guestId, reason, blockedAt: Date.now() };
    await kv.put(`blocked:${guestId}`, "true");
    await kv.put(`block-info:${guestId}`, JSON.stringify(blockData));
    await incrementCounter(kv, "total-blocked");
    await kv.delete(`trust:${guestId}`);
    return;
  }

  await kv.delete(`blocked:${guestId}`);
  await kv.delete(`block-info:${guestId}`);
  await decrementCounter(kv, "total-blocked");
}

export async function getBlockInfo(
  kv: KVNamespace,
  guestId: string,
): Promise<BlockInfo | null> {
  const data = await kv.get(`block-info:${guestId}`, { type: "json" });
  return (data as BlockInfo | null) || null;
}

export async function getBlockedList(kv: KVNamespace): Promise<BlockInfo[]> {
  const list = await kv.list({ prefix: "block-info:" });
  const results = await Promise.all(
    list.keys.map((key) => kv.get(key.name, { type: "json" })),
  );

  return results.filter(Boolean) as BlockInfo[];
}

export async function incrementCounter(
  kv: KVNamespace,
  name: string,
): Promise<void> {
  const current = parseInteger(
    await kv.get(`counter:${name}`, { type: "text" }),
  );
  await kv.put(`counter:${name}`, String(current + 1));
}

export async function decrementCounter(
  kv: KVNamespace,
  name: string,
): Promise<void> {
  const current = parseInteger(
    await kv.get(`counter:${name}`, { type: "text" }),
  );
  if (current > 0) {
    await kv.put(`counter:${name}`, String(current - 1));
  }
}

export async function getCounter(
  kv: KVNamespace,
  name: string,
): Promise<number> {
  return parseInteger(await kv.get(`counter:${name}`, { type: "text" }));
}

export async function getStatistics(kv: KVNamespace): Promise<Statistics> {
  const totalRelays = await getCounter(kv, "total-relays");
  const aiBlocks = await getCounter(kv, "ai-blocks");
  const blockedList = await getBlockedList(kv);

  return {
    totalRelays,
    totalBlocked: blockedList.length,
    aiBlocks,
  };
}

export async function checkRateLimit(
  kv: KVNamespace,
  guestId: string,
): Promise<RateLimitResult> {
  const key = `ratelimit:${guestId}`;
  const now = Date.now();
  const data = await kv.get(key, { type: "json" });
  const record = data as RateLimitRecord | null;

  if (!record || now - record.windowStart > RATE_LIMIT_WINDOW_MS) {
    const nextRecord: RateLimitRecord = { windowStart: now, count: 1 };
    await kv.put(key, JSON.stringify(nextRecord), {
      expirationTtl: RATE_LIMIT_TTL_SECONDS,
    });
    return { allowed: true, remaining: RATE_LIMIT_MAX_REQUESTS - 1 };
  }

  if (record.count >= RATE_LIMIT_MAX_REQUESTS) {
    const resetIn = Math.ceil(
      (record.windowStart + RATE_LIMIT_WINDOW_MS - now) / 1000,
    );
    return { allowed: false, remaining: 0, resetIn };
  }

  const nextRecord: RateLimitRecord = {
    windowStart: record.windowStart,
    count: record.count + 1,
  };

  await kv.put(key, JSON.stringify(nextRecord), {
    expirationTtl: RATE_LIMIT_TTL_SECONDS,
  });

  return {
    allowed: true,
    remaining: RATE_LIMIT_MAX_REQUESTS - record.count - 1,
  };
}

export function getRateLimitConfig() {
  return {
    maxRequests: RATE_LIMIT_MAX_REQUESTS,
    windowMs: RATE_LIMIT_WINDOW_MS,
  };
}

export async function getTrustScore(
  kv: KVNamespace,
  guestId: string,
): Promise<number> {
  return parseInteger(await kv.get(`trust:${guestId}`, { type: "text" }));
}

export async function incrementTrustScore(
  kv: KVNamespace,
  guestId: string,
): Promise<void> {
  const current = await getTrustScore(kv, guestId);
  if (current < TRUST_THRESHOLD) {
    await kv.put(`trust:${guestId}`, String(current + 1));
  }
}

export async function resetTrustScore(
  kv: KVNamespace,
  guestId: string,
): Promise<void> {
  await kv.delete(`trust:${guestId}`);
}

export async function isUserTrusted(
  kv: KVNamespace,
  guestId: string,
): Promise<boolean> {
  const score = await getTrustScore(kv, guestId);
  return score >= TRUST_THRESHOLD;
}

export async function setUserTrusted(
  kv: KVNamespace,
  guestId: string,
): Promise<void> {
  await kv.put(`trust:${guestId}`, String(TRUST_THRESHOLD));
}

async function generateContentHash(content: string): Promise<string> {
  const data = new TextEncoder().encode(content);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function getCachedModerationResult(
  kv: KVNamespace,
  content: string | undefined,
): Promise<CachedModerationResult> {
  if (!content || content.length < MOD_CACHE_MIN_LENGTH) {
    return { hit: false, result: null };
  }

  const hash = await generateContentHash(content);
  const cached = await kv.get(`modcache:${hash}`, { type: "text" });

  if (cached === null) {
    return { hit: false, result: null };
  }

  if (cached === "SAFE") {
    return { hit: true, result: null };
  }

  return { hit: true, result: cached.replace("UNSAFE:", "") };
}

export async function cacheModerationResult(
  kv: KVNamespace,
  content: string | undefined,
  result: string | null,
): Promise<void> {
  if (!content || content.length < MOD_CACHE_MIN_LENGTH) {
    return;
  }

  const hash = await generateContentHash(content);
  const value = result ? `UNSAFE:${result}` : "SAFE";
  await kv.put(`modcache:${hash}`, value, {
    expirationTtl: MOD_CACHE_TTL_SECONDS,
  });
}

export async function getUserLanguage(
  kv: KVNamespace,
  userId: string,
): Promise<string | null> {
  return kv.get(`lang:${userId}`, { type: "text" });
}

export async function setUserLanguage(
  kv: KVNamespace,
  userId: string,
  lang: string,
): Promise<void> {
  await kv.put(`lang:${userId}`, lang);
}
