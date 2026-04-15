import {
  checkContentSafety,
  checkImageSafety,
  MODERATION_STATUS,
  parseApiKeys,
} from "../ai.ts";
import { AUTO_BLOCK, ENABLE_FILTER } from "../config.ts";
import { buildLanguageKeyboard, getUserLangOrDefault, t } from "../i18n.ts";
import {
  cacheModerationResult,
  checkRateLimit,
  createRelay,
  getBlockInfo,
  getCachedModerationResult,
  incrementCounter,
  incrementTrustScore,
  isGuestBlocked,
  isUserTrusted,
  linkAdminMessage,
  setGuestBlocked,
} from "../storage.ts";
import type {
  Env,
  ModerationResult,
  TelegramClient,
  TelegramInlineKeyboardMarkup,
  TelegramMessage,
} from "../types.ts";

async function sendToGuest(
  telegram: TelegramClient,
  chatId: string | number,
  text: string,
  options: { reply_markup?: TelegramInlineKeyboardMarkup } = {},
) {
  const result = await telegram.sendMessage({
    chat_id: chatId,
    text,
    ...options,
  });

  if (!result.ok) {
    console.warn(`[Guest] sendMessage failed: ${JSON.stringify(result)}`);
  }

  return result;
}

async function getFileUrl(
  telegram: TelegramClient,
  fileId: string,
  logPrefix = "file",
): Promise<string | null> {
  const fileResult = await telegram.getFile({ file_id: fileId });
  if (!fileResult.ok) {
    console.log(`[Guest] Failed to get ${logPrefix}`);
    return null;
  }

  return telegram.getFileUrl(fileResult.result.file_path);
}

async function getImageUrl(
  message: TelegramMessage,
  telegram: TelegramClient,
): Promise<string | null> {
  if (!message.photo?.length) {
    return null;
  }

  const photo = message.photo[message.photo.length - 1];
  return getFileUrl(telegram, photo.file_id, "photo");
}

async function getStickerUrl(
  message: TelegramMessage,
  telegram: TelegramClient,
): Promise<string | null> {
  const sticker = message.sticker;
  if (!sticker) {
    return null;
  }

  if (sticker.is_animated || sticker.is_video) {
    console.log("[Guest] Skipping animated/video sticker");
    return null;
  }

  return getFileUrl(telegram, sticker.file_id, "sticker");
}

function buildAppealKeyboard(
  guestId: string,
  lang: string,
): TelegramInlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        {
          text: t("appeal_accept_button", {}, lang),
          callback_data: `appeal:accept:${guestId}`,
        },
        {
          text: t("appeal_reject_button", {}, lang),
          callback_data: `appeal:reject:${guestId}`,
        },
      ],
    ],
  };
}

async function handleLangCommand(
  telegram: TelegramClient,
  guestId: string,
  lang: string,
) {
  return sendToGuest(telegram, guestId, t("lang_select_prompt", {}, lang), {
    reply_markup: buildLanguageKeyboard(guestId),
  });
}

async function handleStartCommand(
  telegram: TelegramClient,
  guestId: string,
  lang: string,
) {
  return sendToGuest(telegram, guestId, t("guest_welcome", {}, lang));
}

async function handleAppealCommand(
  message: TelegramMessage,
  telegram: TelegramClient,
  kv: KVNamespace,
  env: Env,
) {
  const guestId = String(message.chat.id);
  const username =
    message.from?.username || message.from?.first_name || "Unknown";
  const guestLang = await getUserLangOrDefault(kv, guestId);
  const adminLang = await getUserLangOrDefault(kv, env.ENV_ADMIN_UID);

  const blockInfo = await getBlockInfo(kv, guestId);
  const blockReason = blockInfo?.reason || "Unknown";
  const blockDate = blockInfo?.blockedAt
    ? new Date(blockInfo.blockedAt).toLocaleString()
    : "Unknown";

  let appealText = t("appeal_title", {}, adminLang);
  appealText += t("appeal_from", { username, guestId }, adminLang);
  appealText += t("appeal_blocked", { date: blockDate }, adminLang);
  appealText += t("appeal_reason", { reason: blockReason }, adminLang);
  appealText += t("appeal_separator", {}, adminLang);

  const appealContent = message.text?.replace("/appeal", "").trim();
  appealText += appealContent
    ? t("appeal_message", { content: appealContent }, adminLang)
    : t("appeal_no_message", {}, adminLang);

  await telegram.sendMessage({
    chat_id: env.ENV_ADMIN_UID,
    text: appealText,
    reply_markup: buildAppealKeyboard(guestId, adminLang),
  });

  if (message.reply_to_message) {
    await telegram.forwardMessage({
      chat_id: env.ENV_ADMIN_UID,
      from_chat_id: guestId,
      message_id: message.reply_to_message.message_id,
    });
  }

  return sendToGuest(
    telegram,
    guestId,
    t("guest_appeal_submitted", {}, guestLang),
  );
}

async function checkMessageContent(
  message: TelegramMessage,
  telegram: TelegramClient,
  kv: KVNamespace,
  apiKeys: string | string[] | null,
): Promise<ModerationResult> {
  const textContent = message.text || message.caption;

  if (textContent) {
    const cached = await getCachedModerationResult(kv, textContent);
    if (cached.hit) {
      console.log("[Guest] Cache hit for text content");
      return cached.result
        ? { status: MODERATION_STATUS.UNSAFE, reason: cached.result }
        : { status: MODERATION_STATUS.SAFE, reason: null };
    }

    const result = await checkContentSafety(textContent, apiKeys);
    if (result.status !== MODERATION_STATUS.ERROR) {
      await cacheModerationResult(
        kv,
        textContent,
        result.status === MODERATION_STATUS.UNSAFE ? result.reason : null,
      );
    }
    if (result.status !== MODERATION_STATUS.SAFE) {
      return result;
    }
  }

  if (message.photo) {
    const imageUrl = await getImageUrl(message, telegram);
    if (imageUrl) {
      const result = await checkImageSafety(imageUrl, apiKeys, message.caption);
      if (result.status !== MODERATION_STATUS.SAFE) {
        return result;
      }
    }
  }

  if (message.sticker) {
    const stickerUrl = await getStickerUrl(message, telegram);
    if (stickerUrl) {
      const result = await checkImageSafety(stickerUrl, apiKeys);
      if (result.status !== MODERATION_STATUS.SAFE) {
        return result;
      }
    }
  }

  return { status: MODERATION_STATUS.SAFE, reason: null };
}

async function handleUnsafeContent(
  telegram: TelegramClient,
  kv: KVNamespace,
  guestId: string,
  filterReason: string,
  lang: string,
) {
  await incrementCounter(kv, "ai-blocks");

  if (AUTO_BLOCK) {
    await setGuestBlocked(kv, guestId, true, `AI Filter: ${filterReason}`);
  }

  return sendToGuest(
    telegram,
    guestId,
    t("guest_message_blocked", { reason: filterReason }, lang),
  );
}

export async function handleGuestMessage(
  message: TelegramMessage,
  telegram: TelegramClient,
  kv: KVNamespace,
  env: Env,
) {
  try {
    const guestId = String(message.chat.id);
    const lang = await getUserLangOrDefault(kv, guestId);
    const text = message.text || "";

    const blocked = await isGuestBlocked(kv, guestId);

    if (text === "/lang") {
      return handleLangCommand(telegram, guestId, lang);
    }

    if (text.startsWith("/appeal")) {
      if (!blocked) {
        return sendToGuest(telegram, guestId, t("guest_not_blocked", {}, lang));
      }
      return handleAppealCommand(message, telegram, kv, env);
    }

    if (blocked) {
      return sendToGuest(telegram, guestId, t("guest_blocked", {}, lang));
    }

    if (text === "/start") {
      return handleStartCommand(telegram, guestId, lang);
    }

    const rateLimit = await checkRateLimit(kv, guestId);
    if (!rateLimit.allowed) {
      console.log(`[Guest] Rate limited: ${guestId}`);
      return sendToGuest(
        telegram,
        guestId,
        t("guest_rate_limited", { seconds: rateLimit.resetIn || 0 }, lang),
      );
    }

    if (ENABLE_FILTER && env.ENV_GEMINI_API_KEY) {
      const trusted = await isUserTrusted(kv, guestId);

      if (trusted) {
        console.log(`[Guest] Trusted user, skipping AI check: ${guestId}`);
      } else {
        const apiKeys = parseApiKeys(env.ENV_GEMINI_API_KEY);
        const moderation = await checkMessageContent(
          message,
          telegram,
          kv,
          apiKeys,
        );

        if (moderation.status === MODERATION_STATUS.ERROR) {
          console.warn(
            `[Guest] Moderation unavailable for ${guestId}: ${moderation.reason}`,
          );
          return sendToGuest(
            telegram,
            guestId,
            t("guest_moderation_unavailable", {}, lang),
          );
        }

        if (moderation.status === MODERATION_STATUS.UNSAFE) {
          return handleUnsafeContent(
            telegram,
            kv,
            guestId,
            moderation.reason || "Content policy violation",
            lang,
          );
        }

        await incrementTrustScore(kv, guestId);
      }
    }

    const forwarded = await telegram.forwardMessage({
      chat_id: env.ENV_ADMIN_UID,
      from_chat_id: message.chat.id,
      message_id: message.message_id,
    });

    if (!forwarded.ok) {
      console.warn(`[Guest] forwardMessage failed for ${guestId}`);
      return sendToGuest(
        telegram,
        guestId,
        t("guest_delivery_failed", {}, lang),
      );
    }

    const relay = await createRelay(kv, guestId, message);
    await linkAdminMessage(kv, forwarded.result.message_id, relay.id);
  } catch (error) {
    const messageText = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;
    console.error(
      `[Guest] Handler error for ${message.chat?.id}: ${messageText}`,
      stack,
    );

    try {
      const lang = await getUserLangOrDefault(kv, String(message.chat.id));
      await sendToGuest(telegram, message.chat.id, t("guest_error", {}, lang));
    } catch {
      // Ignore secondary errors.
    }
  }
}
