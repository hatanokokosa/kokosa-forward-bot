import { getApiUsageStats } from "../../ai.ts";
import { API_KEY_DISPLAY_LENGTH } from "../../config.ts";
import { buildLanguageKeyboard, isValidUserId, t } from "../../i18n.ts";
import {
  getBlockedList,
  getStatistics,
  setGuestBlocked,
} from "../../storage.ts";
import {
  addRssFeed,
  listRssFeeds,
  refreshRssFeeds,
  removeRssFeed,
  updateRssFeedTitle,
} from "../../rss.ts";
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

const cmdRssList = async (ctx: HandlerContext) => {
  const feeds = await listRssFeeds(ctx.kv);

  if (feeds.length === 0) {
    return sendToAdmin(
      ctx.telegram,
      ctx.adminId,
      t("rss_list_empty", {}, ctx.lang),
    );
  }

  let output = t("rss_list_title", { count: feeds.length }, ctx.lang);

  for (const feed of feeds) {
    const lastCheckedAt = feed.lastCheckedAt
      ? new Date(feed.lastCheckedAt).toLocaleString()
      : "-";
    output += t(
      "rss_list_item",
      {
        id: feed.id,
        title: feed.title,
        url: feed.url,
        status: feed.enabled ? "enabled" : "disabled",
        lastCheckedAt,
      },
      ctx.lang,
    );

    if (feed.lastError) {
      output += t("rss_list_item_error", { error: feed.lastError }, ctx.lang);
    }
  }

  return sendToAdmin(ctx.telegram, ctx.adminId, output);
};

const COMMANDS: Record<string, (ctx: HandlerContext) => Promise<unknown>> = {
  "/start": cmdStart,
  "/lang": cmdLang,
  "/banlist": cmdList,
  "/stats": cmdStats,
  "/rss_list": cmdRssList,
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

async function handleRssAddCommand(ctx: HandlerContext, text: string) {
  const match = text.match(/^\/rss_add\s+(\S+)(?:\s+(.+))?$/);
  const url = match?.[1];
  const title = match?.[2]?.trim();

  if (!url) {
    return sendToAdmin(
      ctx.telegram,
      ctx.adminId,
      t("rss_add_usage", {}, ctx.lang),
    );
  }

  try {
    const { feed, initialItems } = await addRssFeed(ctx.kv, url, title);
    return sendToAdmin(
      ctx.telegram,
      ctx.adminId,
      t(
        "rss_added",
        {
          id: feed.id,
          title: feed.title,
          initialItems,
        },
        ctx.lang,
      ),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return sendToAdmin(
      ctx.telegram,
      ctx.adminId,
      t("rss_error", { message }, ctx.lang),
    );
  }
}

async function handleRssRemoveCommand(ctx: HandlerContext, text: string) {
  const id = text.split(/\s+/)[1]?.trim();

  if (!id) {
    return sendToAdmin(
      ctx.telegram,
      ctx.adminId,
      t("rss_remove_usage", {}, ctx.lang),
    );
  }

  const removed = await removeRssFeed(ctx.kv, id);
  return sendToAdmin(
    ctx.telegram,
    ctx.adminId,
    removed
      ? t("rss_removed", { id }, ctx.lang)
      : t("rss_not_found", { id }, ctx.lang),
  );
}

async function handleRssTitleCommand(ctx: HandlerContext, text: string) {
  const match = text.match(/^\/rss_title\s+(\S+)\s+(.+)$/);
  const id = match?.[1];
  const title = match?.[2]?.trim();

  if (!id || !title) {
    return sendToAdmin(
      ctx.telegram,
      ctx.adminId,
      t("rss_title_usage", {}, ctx.lang),
    );
  }

  const feed = await updateRssFeedTitle(ctx.kv, id, title);
  return sendToAdmin(
    ctx.telegram,
    ctx.adminId,
    feed
      ? t("rss_title_updated", { id, title: feed.title }, ctx.lang)
      : t("rss_not_found", { id }, ctx.lang),
  );
}

async function handleRssRefreshCommand(
  ctx: HandlerContext,
  text: string,
  env: Env,
) {
  const id = text.split(/\s+/)[1]?.trim();
  const result = await refreshRssFeeds(ctx.kv, ctx.telegram, env, id);
  let output = t(
    "rss_refresh_done",
    {
      checked: result.checked,
      sent: result.sent,
      errors: result.errors.length,
    },
    ctx.lang,
  );

  for (const error of result.errors) {
    output += t(
      "rss_refresh_error",
      { id: error.id, message: error.message },
      ctx.lang,
    );
  }

  return sendToAdmin(ctx.telegram, ctx.adminId, output);
}

export async function handleDirectAdminCommand(
  ctx: HandlerContext,
  text: string,
  env: Env,
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

  if (text === "/rss_add" || text.startsWith("/rss_add ")) {
    await handleRssAddCommand(ctx, text);
    return true;
  }

  if (text === "/rss_remove" || text.startsWith("/rss_remove ")) {
    await handleRssRemoveCommand(ctx, text);
    return true;
  }

  if (text === "/rss_title" || text.startsWith("/rss_title ")) {
    await handleRssTitleCommand(ctx, text);
    return true;
  }

  if (text === "/rss_refresh" || text.startsWith("/rss_refresh ")) {
    await handleRssRefreshCommand(ctx, text, env);
    return true;
  }

  return false;
}
