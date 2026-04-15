import { getUserLangOrDefault, t } from "../../i18n.ts";
import { setGuestBlocked, setUserLanguage } from "../../storage.ts";
import type { CallbackQuery, Env, TelegramClient } from "../../types.ts";
import { requireAdminCallback, sendToAdmin } from "./shared.ts";

export async function handleAdminCallbackQuery(
  query: CallbackQuery,
  telegram: TelegramClient,
  kv: KVNamespace,
  env: Env,
) {
  try {
    const [action, ...params] = query.data.split(":");
    const callerId = String(query.from.id);

    if (action === "lang") {
      const [lang, userId] = params;
      if (callerId !== userId) {
        await telegram.answerCallbackQuery({ callback_query_id: query.id });
        return;
      }

      await setUserLanguage(kv, userId, lang);
      await telegram.answerCallbackQuery({ callback_query_id: query.id });
      return telegram.sendMessage({
        chat_id: userId,
        text: t("lang_changed", {}, lang),
      });
    }

    const lang = await getUserLangOrDefault(kv, callerId);
    if (!(await requireAdminCallback(query, telegram, kv, env))) {
      return;
    }

    await telegram.answerCallbackQuery({ callback_query_id: query.id });

    if (action === "appeal") {
      const [decision, guestId] = params;
      const guestLang = await getUserLangOrDefault(kv, guestId);

      if (decision === "accept") {
        await setGuestBlocked(kv, guestId, false);
        await sendToAdmin(
          telegram,
          env.ENV_ADMIN_UID,
          t("appeal_accepted", { guestId }, lang),
        );
        return telegram.sendMessage({
          chat_id: guestId,
          text: t("guest_appeal_accepted", {}, guestLang),
        });
      }

      if (decision === "reject") {
        await sendToAdmin(
          telegram,
          env.ENV_ADMIN_UID,
          t("appeal_rejected", { guestId }, lang),
        );
        return telegram.sendMessage({
          chat_id: guestId,
          text: t("guest_appeal_rejected", {}, guestLang),
        });
      }
    }

    if (action === "unban") {
      const [guestId] = params;
      await setGuestBlocked(kv, guestId, false);
      return sendToAdmin(
        telegram,
        env.ENV_ADMIN_UID,
        t("unbanned", { guestId }, lang),
      );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;
    console.error(`[Admin] Callback error: ${message}`, stack);
  }
}
