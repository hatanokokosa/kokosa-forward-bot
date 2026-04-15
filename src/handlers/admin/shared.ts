import { t, getUserLangOrDefault } from "../../i18n.ts";
import { getRelay, getRelayByAdminMsg } from "../../storage.ts";
import type {
  CallbackQuery,
  Env,
  RelayRecord,
  TelegramClient,
  TelegramInlineKeyboardMarkup,
} from "../../types.ts";

export async function sendToAdmin(
  telegram: TelegramClient,
  adminId: string,
  text: string,
  options: { reply_markup?: TelegramInlineKeyboardMarkup } = {},
) {
  const result = await telegram.sendMessage({
    chat_id: adminId,
    text,
    ...options,
  });

  if (!result.ok) {
    console.warn(`[Admin] sendMessage failed: ${JSON.stringify(result)}`);
  }

  return result;
}

export async function requireAdminCallback(
  query: CallbackQuery,
  telegram: TelegramClient,
  kv: KVNamespace,
  env: Env,
): Promise<boolean> {
  const callerId = String(query.from.id);
  if (callerId === env.ENV_ADMIN_UID) {
    return true;
  }

  const lang = await getUserLangOrDefault(kv, callerId);
  await telegram.answerCallbackQuery({
    callback_query_id: query.id,
    text: t("admin_only_action", {}, lang),
    show_alert: true,
  });

  return false;
}

export async function getReplyRelay(
  kv: KVNamespace,
  replyMsgId: number,
  telegram: TelegramClient,
  adminId: string,
  lang: string,
): Promise<{
  relay: RelayRecord | null;
  relayId: string | null;
  error: boolean;
}> {
  const relayId = await getRelayByAdminMsg(kv, replyMsgId);
  if (!relayId) {
    await sendToAdmin(telegram, adminId, t("cannot_find_user", {}, lang));
    return { relay: null, relayId: null, error: true };
  }

  const relay = await getRelay(kv, relayId);
  if (!relay) {
    await sendToAdmin(telegram, adminId, t("relay_not_found", {}, lang));
    return { relay: null, relayId, error: true };
  }

  return { relay, relayId, error: false };
}
