import { getApiUsageStats } from "../../ai.ts";
import { API_KEY_DISPLAY_LENGTH } from "../../config.ts";
import { buildLanguageKeyboard, isValidUserId, t } from "../../i18n.ts";
import {
  getBlockedList,
  getStatistics,
  setGuestBlocked,
} from "../../storage.ts";
import type {
  Env,
  HandlerContext,
  TelegramInlineKeyboardMarkup,
} from "../../types.ts";
import { sendToAdmin } from "./shared.ts";

const cmdStart = async (ctx: HandlerContext) =>
  sendToAdmin(ctx.telegram, ctx.adminId, t("admin_online", {}, ctx.lang));

const cmdLang = async (ctx: HandlerContext) =>
  sendToAdmin(
    ctx.telegram,
    ctx.adminId,
    t("lang_select_prompt", {}, ctx.lang),
    {
      reply_markup: buildLanguageKeyboard(ctx.userId),
    },
  );

const cmdList = async (ctx: HandlerContext) => {
  const blocked = await getBlockedList(ctx.kv);

  if (blocked.length === 0) {
    return sendToAdmin(
      ctx.telegram,
      ctx.adminId,
      t("no_blocked_users", {}, ctx.lang),
    );
  }

  let output = t("blocked_users_title", { count: blocked.length }, ctx.lang);
  const buttons: TelegramInlineKeyboardMarkup["inline_keyboard"] = [];

  for (const [index, blockedUser] of blocked.entries()) {
    const date = new Date(blockedUser.blockedAt).toLocaleString();
    output += t(
      "blocked_user_item",
      {
        index: index + 1,
        guestId: blockedUser.guestId,
        reason: blockedUser.reason,
        date,
      },
      ctx.lang,
    );

    buttons.push([
      {
        text: t("unban_button", { guestId: blockedUser.guestId }, ctx.lang),
        callback_data: `unban:${blockedUser.guestId}`,
      },
    ]);
  }

  return sendToAdmin(ctx.telegram, ctx.adminId, output, {
    reply_markup: { inline_keyboard: buttons },
  });
};

const cmdStats = async (ctx: HandlerContext) => {
  const stats = await getStatistics(ctx.kv);
  const apiStats = getApiUsageStats();

  let output = t("stats_title", {}, ctx.lang);
  output += t(
    "stats_content",
    {
      totalRelays: stats.totalRelays,
      totalBlocked: stats.totalBlocked,
      aiBlocks: stats.aiBlocks,
    },
    ctx.lang,
  );

  const apiKeys = Object.keys(apiStats);
  if (apiKeys.length > 0) {
    output += t("api_usage_title", {}, ctx.lang);
    for (const [index, key] of apiKeys.entries()) {
      output += t(
        "api_usage_item",
        {
          index: index + 1,
          calls: apiStats[key],
          masked: `${key.substring(0, API_KEY_DISPLAY_LENGTH)}***`,
        },
        ctx.lang,
      );
    }
  }

  return sendToAdmin(ctx.telegram, ctx.adminId, output);
};

const COMMANDS: Record<string, (ctx: HandlerContext) => Promise<unknown>> = {
  "/start": cmdStart,
  "/lang": cmdLang,
  "/banlist": cmdList,
  "/stats": cmdStats,
};

async function handleUnbanCommand(ctx: HandlerContext, text: string) {
  const guestId = text.split(/\s+/)[1]?.trim();
  if (!guestId) {
    return sendToAdmin(
      ctx.telegram,
      ctx.adminId,
      t("unban_usage", {}, ctx.lang),
    );
  }

  if (!isValidUserId(guestId)) {
    return sendToAdmin(
      ctx.telegram,
      ctx.adminId,
      t("invalid_user_id", {}, ctx.lang),
    );
  }

  await setGuestBlocked(ctx.kv, guestId, false);
  return sendToAdmin(
    ctx.telegram,
    ctx.adminId,
    t("unbanned", { guestId }, ctx.lang),
  );
}

export async function handleDirectAdminCommand(
  ctx: HandlerContext,
  text: string,
  _env: Env,
): Promise<boolean> {
  const exactCommand = COMMANDS[text];
  if (exactCommand) {
    await exactCommand(ctx);
    return true;
  }

  if (text.startsWith("/unban ")) {
    await handleUnbanCommand(ctx, text);
    return true;
  }

  return false;
}
