export interface Env {
  ENV_BOT_TOKEN: string;
  ENV_BOT_SECRET: string;
  ENV_ADMIN_UID: string;
  ENV_GEMINI_API_KEY?: string;
  kfb: KVNamespace;
}

export interface TelegramUser {
  id: number;
  first_name?: string;
  username?: string;
}

export interface TelegramChat {
  id: number;
}

export interface TelegramPhotoSize {
  file_id: string;
}

export interface TelegramSticker {
  file_id: string;
  is_animated?: boolean;
  is_video?: boolean;
}

export interface TelegramDocument {
  file_id: string;
}

export interface TelegramMessage {
  message_id: number;
  chat: TelegramChat;
  from?: TelegramUser;
  text?: string;
  caption?: string;
  photo?: TelegramPhotoSize[];
  sticker?: TelegramSticker;
  document?: TelegramDocument;
  reply_to_message?: TelegramMessage;
}

export interface CallbackQuery {
  id: string;
  data: string;
  from: TelegramUser;
  message?: TelegramMessage;
}

export interface TelegramUpdate {
  message?: TelegramMessage;
  callback_query?: CallbackQuery;
  edited_message?: TelegramMessage;
}

export interface TelegramApiSuccess<Result> {
  ok: true;
  result: Result;
}

export interface TelegramApiFailure {
  ok: false;
  description?: string;
  error_code?: number;
}

export type TelegramApiResponse<Result> =
  | TelegramApiSuccess<Result>
  | TelegramApiFailure;

export interface TelegramFile {
  file_path: string;
}

export interface TelegramSentMessage {
  message_id: number;
}

export interface TelegramCommand {
  command: string;
  description: string;
}

export interface TelegramInlineButton {
  text: string;
  callback_data: string;
}

export interface TelegramInlineKeyboardMarkup {
  inline_keyboard: TelegramInlineButton[][];
}

export interface TelegramSendMessageParams {
  chat_id: string | number;
  text: string;
  reply_markup?: TelegramInlineKeyboardMarkup;
}

export interface TelegramForwardMessageParams {
  chat_id: string | number;
  from_chat_id: string | number;
  message_id: number;
}

export interface TelegramCopyMessageParams {
  chat_id: string | number;
  from_chat_id: string | number;
  message_id: number;
}

export interface TelegramWebhookParams {
  url: string;
  secret_token?: string;
  allowed_updates?: string[];
}

export interface TelegramAnswerCallbackParams {
  callback_query_id: string;
  text?: string;
  show_alert?: boolean;
}

export interface TelegramCommandScope {
  type: "chat" | "default";
  chat_id?: number;
}

export interface TelegramSetCommandsParams {
  commands: TelegramCommand[];
  scope: TelegramCommandScope;
}

export interface TelegramGetFileParams {
  file_id: string;
}

export interface TelegramClient {
  sendMessage(
    params: TelegramSendMessageParams,
  ): Promise<TelegramApiResponse<TelegramSentMessage>>;
  copyMessage(
    params: TelegramCopyMessageParams,
  ): Promise<TelegramApiResponse<TelegramSentMessage>>;
  forwardMessage(
    params: TelegramForwardMessageParams,
  ): Promise<TelegramApiResponse<TelegramSentMessage>>;
  setWebhook(params: TelegramWebhookParams): Promise<TelegramApiResponse<true>>;
  answerCallbackQuery(
    params: TelegramAnswerCallbackParams,
  ): Promise<TelegramApiResponse<true>>;
  setMyCommands(
    params: TelegramSetCommandsParams,
  ): Promise<TelegramApiResponse<true>>;
  getFile(
    params: TelegramGetFileParams,
  ): Promise<TelegramApiResponse<TelegramFile>>;
  getFileUrl(filePath: string): string;
}

export type RelayStatus = "open" | "replied" | "blocked";
export type RelayMessageType = "text" | "photo" | "other";

export interface RelayRecord {
  id: string;
  guestId: string;
  guestUsername: string;
  status: RelayStatus;
  createdAt: number;
  updatedAt?: number;
  messageType: RelayMessageType;
  preview: string;
}

export interface BlockInfo {
  guestId: string;
  reason: string;
  blockedAt: number;
}

export interface Statistics {
  totalRelays: number;
  totalBlocked: number;
  aiBlocks: number;
}

export interface RateLimitRecord {
  windowStart: number;
  count: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetIn?: number;
}

export interface CachedModerationResult {
  hit: boolean;
  result: string | null;
}

export interface ModerationResult {
  status: "SAFE" | "UNSAFE" | "ERROR";
  reason: string | null;
}

export interface RssFeed {
  id: string;
  url: string;
  title: string;
  sourceTitle: string;
  enabled: boolean;
  createdAt: number;
  updatedAt?: number;
  lastCheckedAt?: number;
  lastError?: string;
}

export interface RssItem {
  title: string;
  link: string;
  guid?: string;
  publishedAt?: string;
  content?: string;
}

export type TranslationVariables = Record<string, string | number>;
export type LanguageCode = "en" | "zh";

export interface LanguageInfo {
  name: string;
  flag: string;
}

export interface HandlerContext {
  telegram: TelegramClient;
  kv: KVNamespace;
  adminId: string;
  userId: string;
  lang: string;
}
