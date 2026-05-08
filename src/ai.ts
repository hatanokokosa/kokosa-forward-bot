import {
  GEMINI_MAX_RETRIES,
  GEMINI_MODEL,
  GEMINI_REQUEST_TIMEOUT_MS,
  GEMINI_SUMMARY_REQUEST_TIMEOUT_MS,
  MEDIA_DOWNLOAD_TIMEOUT_MS,
} from "./config.ts";
import type { ModerationResult, RssItem } from "./types.ts";

export const MODERATION_STATUS = Object.freeze({
  SAFE: "SAFE",
  UNSAFE: "UNSAFE",
  ERROR: "ERROR",
} as const);

type ModerationStatus =
  (typeof MODERATION_STATUS)[keyof typeof MODERATION_STATUS];

let apiKeyIndex = 0;

function createModerationResult(
  status: ModerationStatus,
  reason: string | null = null,
): ModerationResult {
  return { status, reason };
}

function safeResult(): ModerationResult {
  return createModerationResult(MODERATION_STATUS.SAFE);
}

function unsafeResult(reason = "Content policy violation"): ModerationResult {
  return createModerationResult(MODERATION_STATUS.UNSAFE, reason);
}

function errorResult(
  reason = "Moderation service unavailable",
): ModerationResult {
  return createModerationResult(MODERATION_STATUS.ERROR, reason);
}

async function fetchWithTimeout(
  url: string,
  options: RequestInit | undefined,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...(options || {}),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

function getNextApiKey(apiKeys: string | string[]): string {
  if (typeof apiKeys === "string") {
    return apiKeys;
  }

  if (!Array.isArray(apiKeys) || apiKeys.length === 0) {
    throw new Error("No API keys provided");
  }

  const key = apiKeys[apiKeyIndex % apiKeys.length];
  apiKeyIndex += 1;
  console.log(`[AI] Using API key #${(apiKeyIndex % apiKeys.length) + 1}`);

  return key;
}

const MODERATION_PROMPT = `
# Role
Content Moderator API. Output one word only.

# Rules
UNSAFE if:
- Real human nudity/sex
- QR codes/spam/ads/gambling promotion
- Real gore/shock content
- Illegal content promotion
- Scam/phishing attempts

SAFE if:
- 2D/Anime/Cartoon (even suggestive)
- Normal photos/text/screenshots
- Regular conversation

# Output
One word: "SAFE" or "UNSAFE"

Analyze the content:`;

const RSS_SUMMARY_PROMPT = `
# Role
RSS article summarizer.

# Rules
- Output one concise sentence only.
- Prefer Chinese if the source text is Chinese; otherwise use English.
- Stay under 80 Chinese characters or 35 English words.
- Do not mention that the text is from RSS.
- Do not add bullets, prefixes, or markdown.

Summarize this article item:`;

export async function checkContentSafety(
  text: string | undefined,
  apiKeys: string | string[] | null,
  model = GEMINI_MODEL,
): Promise<ModerationResult> {
  if (!text || text.length < 2) {
    return safeResult();
  }

  if (!apiKeys) {
    return errorResult("Moderation service is not configured");
  }

  const keys = Array.isArray(apiKeys) ? apiKeys : [apiKeys];
  const maxRetries = Math.min(keys.length, GEMINI_MAX_RETRIES);

  console.log(`[AI] Checking text, length=${text.length}`);

  const payload = {
    contents: [
      {
        parts: [{ text: `${MODERATION_PROMPT} ${JSON.stringify(text)}` }],
      },
    ],
  };

  return callGeminiApi(payload, keys, maxRetries, model);
}

export async function checkImageSafety(
  imageUrl: string | null | undefined,
  apiKeys: string | string[] | null,
  caption = "",
  model = GEMINI_MODEL,
): Promise<ModerationResult> {
  if (!imageUrl) {
    return safeResult();
  }

  if (!apiKeys) {
    return errorResult("Moderation service is not configured");
  }

  const keys = Array.isArray(apiKeys) ? apiKeys : [apiKeys];
  const maxRetries = Math.min(keys.length, GEMINI_MAX_RETRIES);

  console.log("[AI] Checking image content");

  try {
    const imageResponse = await fetchWithTimeout(
      imageUrl,
      undefined,
      MEDIA_DOWNLOAD_TIMEOUT_MS,
    );
    if (!imageResponse.ok) {
      console.log(`[AI] Failed to download image: ${imageResponse.status}`);
      return errorResult("Unable to download media for moderation");
    }

    const imageBuffer = await imageResponse.arrayBuffer();
    const bytes = new Uint8Array(imageBuffer);

    let binary = "";
    const chunkSize = 8192;
    for (let index = 0; index < bytes.length; index += chunkSize) {
      const chunk = bytes.subarray(index, index + chunkSize);
      binary += String.fromCharCode(...chunk);
    }

    const base64Image = btoa(binary);
    const mimeType = detectMimeType(imageUrl, bytes);

    console.log(
      `[AI] Image downloaded, size: ${imageBuffer.byteLength} bytes, type: ${mimeType}`,
    );

    const parts = [
      { inline_data: { mime_type: mimeType, data: base64Image } },
      {
        text: caption
          ? `${MODERATION_PROMPT} (Caption: ${caption})`
          : MODERATION_PROMPT,
      },
    ];

    return callGeminiApi({ contents: [{ parts }] }, keys, maxRetries, model);
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      console.log("[AI] Image download timed out");
      return errorResult("Media moderation timed out");
    }

    const message = error instanceof Error ? error.message : String(error);
    console.log(`[AI] Image processing error: ${message}`);
    return errorResult("Unable to process media for moderation");
  }
}

function cleanSummaryText(value: string): string {
  return value
    .replace(/^["'“”]+|["'“”]+$/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 500);
}

function buildRssSummaryInput(item: RssItem): string {
  const parts = [
    `Title: ${item.title}`,
    item.publishedAt ? `Published: ${item.publishedAt}` : "",
    item.content ? `Content: ${item.content}` : "",
  ].filter(Boolean);

  return parts.join("\n").slice(0, 3000);
}

export async function summarizeRssItem(
  item: RssItem,
  apiKeys: string | string[] | null,
  model = GEMINI_MODEL,
): Promise<string> {
  if (!apiKeys) {
    return "AI summary unavailable.";
  }

  const keys = Array.isArray(apiKeys) ? apiKeys : [apiKeys];
  const maxRetries = Math.min(keys.length, GEMINI_MAX_RETRIES);
  const payload = {
    contents: [
      {
        parts: [
          {
            text: `${RSS_SUMMARY_PROMPT}\n${JSON.stringify(
              buildRssSummaryInput(item),
            )}`,
          },
        ],
      },
    ],
  };

  const summary = await callGeminiTextApi(payload, keys, maxRetries, model);
  return summary || "AI summary unavailable.";
}

function detectMimeType(imageUrl: string, bytes: Uint8Array): string {
  if (imageUrl.includes(".png")) {
    return "image/png";
  }
  if (imageUrl.includes(".gif")) {
    return "image/gif";
  }
  if (imageUrl.includes(".webp")) {
    return "image/webp";
  }
  if (bytes[0] === 0x89 && bytes[1] === 0x50) {
    return "image/png";
  }
  if (bytes[0] === 0x47 && bytes[1] === 0x49) {
    return "image/gif";
  }
  if (bytes[0] === 0x52 && bytes[1] === 0x49) {
    return "image/webp";
  }
  return "image/jpeg";
}

async function callGeminiApi(
  payload: object,
  keys: string[],
  maxRetries: number,
  model: string,
): Promise<ModerationResult> {
  for (let attempt = 0; attempt < maxRetries; attempt += 1) {
    const apiKey = getNextApiKey(keys);
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    try {
      const response = await fetchWithTimeout(
        endpoint,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
        GEMINI_REQUEST_TIMEOUT_MS,
      );

      if (!response.ok) {
        console.log(
          `[AI] API Error (attempt ${attempt + 1}): ${response.status}`,
        );
        const errText = await response.text();
        console.log(`[AI] Details: ${errText.substring(0, 200)}`);

        if (attempt < maxRetries - 1) {
          console.log("[AI] Switching to next API key...");
          continue;
        }
        return errorResult("Moderation service unavailable");
      }

      const data = (await response.json()) as GeminiResponse;
      const result = data.candidates?.[0]?.content?.parts?.[0]?.text
        ?.trim()
        .toUpperCase();

      console.log(`[AI] Result: ${result}`);

      if (result?.includes("UNSAFE")) {
        return unsafeResult();
      }
      if (result?.includes("SAFE")) {
        return safeResult();
      }
      return errorResult("Unexpected moderation response");
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        console.log(`[AI] Request timed out (attempt ${attempt + 1})`);
      } else {
        const message = error instanceof Error ? error.message : String(error);
        console.log(`[AI] Exception (attempt ${attempt + 1}): ${message}`);
      }

      if (attempt < maxRetries - 1) {
        console.log("[AI] Switching to next API key...");
        continue;
      }
      return errorResult("Moderation service unavailable");
    }
  }

  return errorResult("Moderation service unavailable");
}

async function callGeminiTextApi(
  payload: object,
  keys: string[],
  maxRetries: number,
  model: string,
): Promise<string | null> {
  for (let attempt = 0; attempt < maxRetries; attempt += 1) {
    const apiKey = getNextApiKey(keys);
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    try {
      const response = await fetchWithTimeout(
        endpoint,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
        GEMINI_SUMMARY_REQUEST_TIMEOUT_MS,
      );

      if (!response.ok) {
        console.log(
          `[AI] Summary API error (attempt ${attempt + 1}): ${response.status}`,
        );
        const errText = await response.text();
        console.log(`[AI] Summary details: ${errText.substring(0, 300)}`);

        if (attempt < maxRetries - 1) {
          continue;
        }

        return null;
      }

      const data = (await response.json()) as GeminiResponse;
      const result = data.candidates?.[0]?.content?.parts?.[0]?.text;
      return result ? cleanSummaryText(result) : null;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.log(
        `[AI] Summary exception (attempt ${attempt + 1}): ${message}`,
      );

      if (attempt < maxRetries - 1) {
        continue;
      }

      return null;
    }
  }

  return null;
}

export function formatModerationStatus(
  result: ModerationResult | null,
): string {
  if (!result || result.status === MODERATION_STATUS.SAFE) {
    return MODERATION_STATUS.SAFE;
  }

  if (!result.reason) {
    return result.status;
  }

  return `${result.status}: ${result.reason}`;
}

export function parseApiKeys(
  keyString: string | undefined,
): string | string[] | null {
  if (!keyString) {
    return null;
  }

  if (keyString.includes(",")) {
    const keys = keyString
      .split(",")
      .map((key) => key.trim())
      .filter(Boolean);
    return keys.length > 0 ? keys : null;
  }

  const key = keyString.trim();
  return key || null;
}

interface GeminiResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
      }>;
    };
  }>;
}
