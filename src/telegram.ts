import type {
  TelegramAnswerCallbackParams,
  TelegramApiResponse,
  TelegramClient,
  TelegramCommandScope,
  TelegramCopyMessageParams,
  TelegramFile,
  TelegramForwardMessageParams,
  TelegramGetFileParams,
  TelegramInlineKeyboardMarkup,
  TelegramSentMessage,
  TelegramWebhookParams,
} from "./types.ts";

interface TelegramSendMessagePayload {
  chat_id: string | number;
  text: string;
  reply_markup?: TelegramInlineKeyboardMarkup;
}

interface TelegramSetCommandsPayload {
  commands: Array<{ command: string; description: string }>;
  scope: TelegramCommandScope;
}

type TelegramRequestBody =
  | TelegramAnswerCallbackParams
  | TelegramCopyMessageParams
  | TelegramForwardMessageParams
  | TelegramGetFileParams
  | TelegramSendMessagePayload
  | TelegramSetCommandsPayload
  | TelegramWebhookParams;

async function parseTelegramResponse<Result>(
  response: Response,
): Promise<TelegramApiResponse<Result>> {
  return (await response.json()) as TelegramApiResponse<Result>;
}

export function createTelegramClient(token: string): TelegramClient {
  const apiUrl = (method: string) =>
    `https://api.telegram.org/bot${token}/${method}`;

  async function request<Result>(
    method: string,
    body: TelegramRequestBody,
  ): Promise<TelegramApiResponse<Result>> {
    console.log(`[Telegram API] ${method}`);

    const response = await fetch(apiUrl(method), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

    return parseTelegramResponse<Result>(response);
  }

  return {
    sendMessage: (params) =>
      request<TelegramSentMessage>("sendMessage", params),
    copyMessage: (params) =>
      request<TelegramSentMessage>("copyMessage", params),
    forwardMessage: (params) =>
      request<TelegramSentMessage>("forwardMessage", params),
    setWebhook: (params) => request<true>("setWebhook", params),
    answerCallbackQuery: (params) =>
      request<true>("answerCallbackQuery", params),
    setMyCommands: (params) => request<true>("setMyCommands", params),
    getFile: (params) => request<TelegramFile>("getFile", params),
    getFileUrl: (filePath) =>
      `https://api.telegram.org/file/bot${token}/${filePath}`,
  };
}
