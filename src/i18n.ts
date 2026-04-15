import { LANGUAGE } from "./config.ts";
import en from "./i18n/en.ts";
import { getUserLanguage } from "./storage.ts";
import zh from "./i18n/zh.ts";
import type {
  LanguageCode,
  LanguageInfo,
  TelegramInlineKeyboardMarkup,
  TranslationVariables,
} from "./types.ts";

type MessageDictionary = Record<string, string>;

const messages: Record<LanguageCode, MessageDictionary> = {
  en,
  zh,
};

const defaultLanguage = LANGUAGE;

export function getAvailableLanguages(): LanguageCode[] {
  return Object.keys(messages) as LanguageCode[];
}

export function getLanguageInfo(lang: string): LanguageInfo {
  const language = messages[lang as LanguageCode];
  if (!language) {
    return { name: lang, flag: "🌐" };
  }

  return {
    name: language.lang_name,
    flag: language.lang_flag,
  };
}

export function buildLanguageKeyboard(
  userId: string,
): TelegramInlineKeyboardMarkup {
  const buttons = getAvailableLanguages().map((lang) => {
    const info = getLanguageInfo(lang);
    return {
      text: `${info.flag} ${info.name}`,
      callback_data: `lang:${lang}:${userId}`,
    };
  });

  return { inline_keyboard: [buttons] };
}

export function t(
  key: string,
  vars: TranslationVariables = {},
  lang: string | null = null,
): string {
  const language = (lang || defaultLanguage) as LanguageCode;
  const langMessages = messages[language] || messages.en;
  let message = langMessages[key] || messages.en[key] || key;

  for (const [varName, value] of Object.entries(vars)) {
    message = message.replace(
      new RegExp(`\\{${varName}\\}`, "g"),
      String(value),
    );
  }

  return message;
}

export function getDefaultLanguage(): LanguageCode {
  return defaultLanguage;
}

export async function getUserLangOrDefault(
  kv: KVNamespace,
  userId: string,
): Promise<LanguageCode> {
  const language = await getUserLanguage(kv, userId);
  if (language && language in messages) {
    return language as LanguageCode;
  }

  return defaultLanguage;
}

export function isValidUserId(id: string | undefined): id is string {
  return typeof id === "string" && /^\d+$/.test(id);
}
