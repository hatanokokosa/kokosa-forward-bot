import { getUserLangOrDefault } from "../../i18n.ts";
import type {
  Env,
  HandlerContext,
  TelegramClient,
  TelegramMessage,
  CallbackQuery,
} from "../../types.ts";
import { handleAdminCallbackQuery } from "./callbacks.ts";
import { handleDirectAdminCommand } from "./commands.ts";
import { forwardAdminReply, handleReplyAdminCommand } from "./replies.ts";

function createHandlerContext(
  message: TelegramMessage,
  telegram: TelegramClient,
  kv: KVNamespace,
  env: Env,
  lang: string,
): HandlerContext {
  return {
    telegram,
    kv,
    adminId: env.ENV_ADMIN_UID,
    userId: String(message.from?.id || ""),
    lang,
  };
}

export async function handleCallbackQuery(
  query: CallbackQuery,
  telegram: TelegramClient,
  kv: KVNamespace,
  env: Env,
) {
  return handleAdminCallbackQuery(query, telegram, kv, env);
}

export async function handleAdminMessage(
  message: TelegramMessage,
  telegram: TelegramClient,
  kv: KVNamespace,
  env: Env,
) {
  try {
    const userId = String(message.from?.id || "");
    const lang = await getUserLangOrDefault(kv, userId);
    const ctx = createHandlerContext(message, telegram, kv, env, lang);
    const text = message.text || "";

    if (await handleDirectAdminCommand(ctx, text, env)) {
      return;
    }

    if (await handleReplyAdminCommand(ctx, message, env)) {
      return;
    }

    if (message.reply_to_message) {
      await forwardAdminReply(ctx, message);
    }
  } catch (error) {
    const messageText = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;
    console.error(
      `[Admin] Handler error for ${message.from?.id}: ${messageText}`,
      stack,
    );
  }
}
