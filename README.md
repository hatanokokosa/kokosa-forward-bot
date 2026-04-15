# kfb (kokosa-forward-bot)

[🇨🇳 中文文档](README_CN.md)

A private Telegram forward bot built on Cloudflare Workers. Guest messages are forwarded to the admin, and admin replies are sent back to the original sender. The bot also supports AI moderation, ban/trust management, and basic multilingual replies.

## Requirements

- Bun
- Node.js 20+ for Wrangler CLI
- Cloudflare account
- Telegram bot token from [@BotFather](https://t.me/BotFather)
- Gemini API key from [Google AI Studio](https://aistudio.google.com/app/apikey)

## Deploy

1. Install dependencies:

```bash
git clone https://github.com/hatanokokosa/kokosa-forward-bot.git
cd kokosa-forward-bot
bun install
```

2. Create KV:

```bash
nix shell nixpkgs#nodejs -c npx wrangler kv namespace create kfb
```

3. Create a local `wrangler.toml` and fill in your worker name, domain, env vars, and KV binding:

```toml
name = "kokosa-forward-bot"
main = "src/index.ts"
compatibility_date = "XXXX-XX-XX"

[[kv_namespaces]]
binding = "kfb"
id = "terminal output"

[vars]
ENV_BOT_TOKEN = "from botfather"
ENV_BOT_SECRET = "something random?"
ENV_ADMIN_UID = "your telegram ID"

# Multiple API keys for rotation
ENV_GEMINI_API_KEY = "use ',' to split"
```

4. Deploy:

```bash
bun run deploy
```

5. Register webhook and commands:

```bash
just reg your-url your-secret(ENV_BOT_SECRET)
```

6. Tail logs if needed:

```bash
nix shell nixpkgs#nodejs -c npx wrangler tail
```

## Commands

Admin:

- `/start`
- `/banlist`
- `/stats`
- `/ban`
- `/unban`
- `/trust`
- `/untrust`
- `/status`
- `/check`
- `/lang`

Guest:

- `/start`
- `/appeal`
- `/lang`

## Notes

- `wrangler.toml` should stay local; this repo already ignores it.
- Prefer `npx wrangler ...` under Node.js instead of `bunx wrangler ...`.
- Languages live under `src/i18n/`, one file per language.
