import {
  checkContentSafety,
  checkImageSafety,
  formatModerationStatus,
  parseApiKeys,
} from "../../ai.ts";
import { t } from "../../i18n.ts";
import {
  getRelay,
  getRelayByAdminMsg,
  isGuestBlocked,
  resetTrustScore,
  setGuestBlocked,
  setUserTrusted,
  updateRelayStatus,
} from "../../storage.ts";
import type {
  Env,
  HandlerContext,
  RelayRecord,
  TelegramMessage,
} from "../../types.ts";
import { getReplyRelay, sendToAdmin } from "./shared.ts";

const replyBlock = async (
  ctx: HandlerContext,
  relay: RelayRecord,
  relayId: string,
) => {
  await setGuestBlocked(ctx.kv, relay.guestId, true, "Manual block by admin");
  await updateRelayStatus(ctx.kv, relayId, "blocked");
  return sendToAdmin(
    ctx.telegram,
    ctx.adminId,
    t(
      "blocked",
      { guestId: relay.guestId, username: relay.guestUsername },
      ctx.lang,
    ),
  );
};

const replyTrust = async (ctx: HandlerContext, relay: RelayRecord) => {
  await setUserTrusted(ctx.kv, relay.guestId);
  return sendToAdmin(
    ctx.telegram,
    ctx.adminId,
    t(
      "trusted",
      { guestId: relay.guestId, username: relay.guestUsername },
      ctx.lang,
    ),
  );
};

const replyUntrust = async (ctx: HandlerContext, relay: RelayRecord) => {
  await resetTrustScore(ctx.kv, relay.guestId);
  return sendToAdmin(
    ctx.telegram,
    ctx.adminId,
    t(
      "untrusted",
      { guestId: relay.guestId, username: relay.guestUsername },
      ctx.lang,
    ),
  );
};

const replyUnblock = async (ctx: HandlerContext, relay: RelayRecord) => {
  await setGuestBlocked(ctx.kv, relay.guestId, false);
  return sendToAdmin(
    ctx.telegram,
    ctx.adminId,
    t("unblocked", { guestId: relay.guestId }, ctx.lang),
  );
};

const replyStatus = async (ctx: HandlerContext, relay: RelayRecord) => {
  const blocked = await isGuestBlocked(ctx.kv, relay.guestId);
  return sendToAdmin(
    ctx.telegram,
    ctx.adminId,
    t(
      "user_status",
      {
        guestId: relay.guestId,
        username: relay.guestUsername,
        blocked: blocked ? "Yes" : "No",
        status: relay.status,
      },
      ctx.lang,
    ),
  );
};

const replyCheck = async (
  ctx: HandlerContext,
  relay: RelayRecord,
  _relayId: string,
  env: Env,
  replyMsg: TelegramMessage | null,
) => {
  const apiKeys = parseApiKeys(env.ENV_GEMINI_API_KEY);
  const results: string[] = [];

  const textContent = replyMsg?.caption || replyMsg?.text || relay.preview;
  if (textContent) {
    const textResult = await checkContentSafety(textContent, apiKeys);
    results.push(
      t(
        "content_check",
        { status: formatModerationStatus(textResult) },
        ctx.lang,
      ),
    );
  }

  if (replyMsg?.photo?.length) {
    const photo = replyMsg.photo[replyMsg.photo.length - 1];
    const fileResult = await ctx.telegram.getFile({ file_id: photo.file_id });
    if (fileResult.ok) {
      const imageUrl = ctx.telegram.getFileUrl(fileResult.result.file_path);
      const imageResult = await checkImageSafety(imageUrl, apiKeys);
      results.push(
        t(
          "image_check",
          { status: formatModerationStatus(imageResult) },
          ctx.lang,
        ),
      );
    } else {
      results.push(
        t("image_check", { status: "ERROR: Unable to fetch file" }, ctx.lang),
      );
    }
  }

  if (results.length === 0) {
    return sendToAdmin(
      ctx.telegram,
      ctx.adminId,
      t("no_content_to_check", {}, ctx.lang),
    );
  }

  return sendToAdmin(ctx.telegram, ctx.adminId, results.join("\n"));
};

type ReplyHandler = (
  ctx: HandlerContext,
  relay: RelayRecord,
  relayId: string,
  env: Env,
  replyMsg: TelegramMessage | null,
) => Promise<unknown>;

const REPLY_COMMANDS: Record<
  string,
  {
    handler: ReplyHandler;
    needsMsg: boolean;
  }
> = {
  "/ban": {
    handler: (ctx, relay, relayId) => replyBlock(ctx, relay, relayId),
    needsMsg: false,
  },
  "/trust": {
    handler: (ctx, relay) => replyTrust(ctx, relay),
    needsMsg: false,
  },
  "/untrust": {
    handler: (ctx, relay) => replyUntrust(ctx, relay),
    needsMsg: false,
  },
  "/unban": {
    handler: (ctx, relay) => replyUnblock(ctx, relay),
    needsMsg: false,
  },
  "/status": {
    handler: (ctx, relay) => replyStatus(ctx, relay),
    needsMsg: false,
  },
  "/check": {
    handler: replyCheck,
    needsMsg: true,
  },
};

export async function handleReplyAdminCommand(
  ctx: HandlerContext,
  message: TelegramMessage,
  env: Env,
): Promise<boolean> {
  if (!message.reply_to_message) {
    return false;
  }

  const text = message.text || "";
  const replyCmd = REPLY_COMMANDS[text];
  if (!replyCmd) {
    return false;
  }

  const replyMsgId = message.reply_to_message.message_id;
  const { relay, relayId, error } = await getReplyRelay(
    ctx.kv,
    replyMsgId,
    ctx.telegram,
    ctx.adminId,
    ctx.lang,
  );

  if (error || !relay || !relayId) {
    return true;
  }

  const replyMsg = replyCmd.needsMsg ? message.reply_to_message : null;
  await replyCmd.handler(ctx, relay, relayId, env, replyMsg);
  return true;
}

export async function forwardAdminReply(
  ctx: HandlerContext,
  message: TelegramMessage,
): Promise<void> {
  const replyMsgId = message.reply_to_message?.message_id;
  if (!replyMsgId) {
    return;
  }

  const relayId = await getRelayByAdminMsg(ctx.kv, replyMsgId);
  if (!relayId) {
    await sendToAdmin(
      ctx.telegram,
      ctx.adminId,
      t("cannot_find_sender", {}, ctx.lang),
    );
    return;
  }

  const relay = await getRelay(ctx.kv, relayId);
  if (!relay) {
    await sendToAdmin(
      ctx.telegram,
      ctx.adminId,
      t("relay_data_not_found", {}, ctx.lang),
    );
    return;
  }

  const blocked = await isGuestBlocked(ctx.kv, relay.guestId);
  if (blocked) {
    await sendToAdmin(
      ctx.telegram,
      ctx.adminId,
      t("user_blocked_cannot_reply", {}, ctx.lang),
    );
    return;
  }

  await ctx.telegram.copyMessage({
    chat_id: relay.guestId,
    from_chat_id: ctx.adminId,
    message_id: message.message_id,
  });

  await updateRelayStatus(ctx.kv, relayId, "replied");
}
