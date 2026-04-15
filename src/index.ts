import { WEBHOOK_PATH } from "./config.ts";
import {
  handleAdminMessage,
  handleCallbackQuery,
} from "./handlers/admin/index.ts";
import { handleGuestMessage } from "./handlers/guest.ts";
import { createTelegramClient } from "./telegram.ts";
import type {
  Env,
  TelegramCommand,
  TelegramClient,
  TelegramMessage,
  TelegramUpdate,
} from "./types.ts";

const ADMIN_COMMANDS: TelegramCommand[] = [
  { command: "start", description: "Start the bot" },
  { command: "banlist", description: "View banned users" },
  { command: "stats", description: "View statistics" },
  { command: "ban", description: "Ban user (reply to message)" },
  { command: "unban", description: "Unban user (reply or by ID)" },
  { command: "trust", description: "Whitelist user (reply to message)" },
  {
    command: "untrust",
    description: "Remove from whitelist (reply to message)",
  },
  { command: "status", description: "Check user status (reply to message)" },
  { command: "check", description: "AI check text/image (reply to message)" },
  { command: "lang", description: "Change language" },
];

const GUEST_COMMANDS: TelegramCommand[] = [
  { command: "start", description: "Start the bot" },
  { command: "appeal", description: "Appeal if blocked" },
  { command: "lang", description: "Change language" },
];

function describeMessage(message: TelegramMessage): string {
  if (message.text) return "text";
  if (message.photo) return "photo";
  if (message.sticker) return "sticker";
  if (message.document) return "document";
  return "other";
}

function isAuthorizedAdminRequest(request: Request, env: Env): boolean {
  return request.headers.get("X-Admin-Secret") === env.ENV_BOT_SECRET;
}

async function handleProtectedAdminRoute(
  request: Request,
  env: Env,
  handler: (request: Request, env: Env) => Promise<Response>,
): Promise<Response> {
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { Allow: "POST" },
    });
  }

  if (!isAuthorizedAdminRequest(request, env)) {
    console.warn("[Auth] Unauthorized admin route access");
    return new Response("Unauthorized", { status: 403 });
  }

  return handler(request, env);
}

async function handleMessageUpdate(
  update: TelegramUpdate,
  telegram: TelegramClient,
  kv: KVNamespace,
  env: Env,
): Promise<void> {
  const message = update.message;
  if (!message) {
    return;
  }

  const chatId = String(message.chat.id);
  console.log(`[Message] From ${chatId}, type=${describeMessage(message)}`);

  if (chatId === env.ENV_ADMIN_UID) {
    await handleAdminMessage(message, telegram, kv, env);
    return;
  }

  await handleGuestMessage(message, telegram, kv, env);
}

async function handleCallbackUpdate(
  update: TelegramUpdate,
  telegram: TelegramClient,
  kv: KVNamespace,
  env: Env,
): Promise<void> {
  const query = update.callback_query;
  if (!query) {
    return;
  }

  console.log(`[Callback] Action: ${query.data}`);
  await handleCallbackQuery(query, telegram, kv, env);
}

async function handleEditedMessage(
  update: TelegramUpdate,
  telegram: TelegramClient,
  _kv: KVNamespace,
  env: Env,
): Promise<void> {
  const message = update.edited_message;
  if (!message) {
    return;
  }

  const chatId = String(message.chat.id);
  console.log(`[Edit] Message ${message.message_id} was edited by ${chatId}`);

  if (chatId === env.ENV_ADMIN_UID) {
    return;
  }

  const editWarning = `[EDITED MESSAGE]
From: ${message.from?.username || message.from?.first_name || "Unknown"} (${chatId})
Content: ${(message.text || message.caption || "[Media]").substring(0, 200)}`;

  await telegram.sendMessage({
    chat_id: env.ENV_ADMIN_UID,
    text: editWarning,
  });
}

async function processUpdate(
  update: TelegramUpdate,
  telegram: TelegramClient,
  kv: KVNamespace,
  env: Env,
): Promise<void> {
  if (update.message) {
    await handleMessageUpdate(update, telegram, kv, env);
    return;
  }

  if (update.callback_query) {
    await handleCallbackUpdate(update, telegram, kv, env);
    return;
  }

  if (update.edited_message) {
    await handleEditedMessage(update, telegram, kv, env);
  }
}

async function handleWebhook(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  if (
    request.headers.get("X-Telegram-Bot-Api-Secret-Token") !==
    env.ENV_BOT_SECRET
  ) {
    console.warn("[Auth] Unauthorized webhook attempt");
    return new Response("Unauthorized", { status: 403 });
  }

  const update = (await request.json()) as TelegramUpdate;
  const telegram = createTelegramClient(env.ENV_BOT_TOKEN);

  ctx.waitUntil(
    processUpdate(update, telegram, env.kfb, env).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[Webhook] Async processing failed: ${message}`);
    }),
  );

  return new Response("Ok");
}

async function registerWebhook(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const webhookUrl = `${url.protocol}//${url.hostname}${WEBHOOK_PATH}`;

  const telegram = createTelegramClient(env.ENV_BOT_TOKEN);
  const result = await telegram.setWebhook({
    url: webhookUrl,
    secret_token: env.ENV_BOT_SECRET,
    allowed_updates: ["message", "callback_query", "edited_message"],
  });

  return new Response(JSON.stringify(result), {
    headers: { "Content-Type": "application/json" },
  });
}

async function unregisterWebhook(
  _request: Request,
  env: Env,
): Promise<Response> {
  const telegram = createTelegramClient(env.ENV_BOT_TOKEN);
  const result = await telegram.setWebhook({ url: "" });

  return new Response(JSON.stringify(result), {
    headers: { "Content-Type": "application/json" },
  });
}

async function registerCommands(
  _request: Request,
  env: Env,
): Promise<Response> {
  const telegram = createTelegramClient(env.ENV_BOT_TOKEN);
  const results = {
    admin: await telegram.setMyCommands({
      commands: ADMIN_COMMANDS,
      scope: { type: "chat", chat_id: Number.parseInt(env.ENV_ADMIN_UID, 10) },
    }),
    default: await telegram.setMyCommands({
      commands: GUEST_COMMANDS,
      scope: { type: "default" },
    }),
  };

  return new Response(JSON.stringify(results), {
    headers: { "Content-Type": "application/json" },
  });
}

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);

    switch (url.pathname) {
      case WEBHOOK_PATH:
        return handleWebhook(request, env, ctx);
      case "/registerWebhook":
        return handleProtectedAdminRoute(request, env, registerWebhook);
      case "/unregisterWebhook":
      case "/unRegisterWebhook":
        return handleProtectedAdminRoute(request, env, unregisterWebhook);
      case "/registerCommands":
        return handleProtectedAdminRoute(request, env, registerCommands);
      default:
        return new Response("Not Found", { status: 404 });
    }
  },
};
