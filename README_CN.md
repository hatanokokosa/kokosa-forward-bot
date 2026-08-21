# kfb (kokosa-forward-bot)

基于 Cloudflare Workers 的私聊转发机器人。访客消息会转发给管理员，管理员回复会回发给原用户；同时支持 AI 审核、封禁/信任管理和基础多语言回复。

## 依赖

- pnpm
- Node.js 20+，用于 Wrangler CLI
- Cloudflare 账号
- 从 [@BotFather](https://t.me/BotFather) 获取的 Telegram Bot Token
- 从 [Google AI Studio](https://aistudio.google.com/app/apikey) 获取的 Gemini API Key

## 部署

1. 安装依赖：

```bash
git clone https://github.com/hatanokokosa/kokosa-forward-bot.git
cd kokosa-forward-bot
pnpm install
```

2. 创建 KV：

```bash
nix shell nixpkgs#nodejs -c npx wrangler kv namespace create kfb
```

3. 在本地创建 `wrangler.toml`，填入 Worker 名称、域名、环境变量和 KV 绑定：

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

[triggers]
crons = ["*/30 * * * *"]
```

4. 部署：

```bash
pnpm run deploy
```

5. 注册 webhook 和命令：

```bash
just reg your-url your-secret(ENV_BOT_SECRET)
```

6. 需要时查看日志：

```bash
nix shell nixpkgs#nodejs -c npx wrangler tail
```

## 命令

管理员：

- `/start`
- `/banlist`
- `/stats`
- `/ban`
- `/unban`
- `/trust`
- `/untrust`
- `/status`
- `/check`
- `/rss_add`
- `/rss_list`
- `/rss_remove`
- `/rss_refresh`
- `/rss_title`
- `/lang`

访客：

- `/start`
- `/appeal`
- `/lang`

## 说明

- `wrangler.toml` 只保留在本地即可，仓库已经忽略它。
- wrangler 跑在 Node.js 下:优先用 `pnpm exec wrangler ...`(或 `npx wrangler ...`)。
- 多语言文件在 `src/i18n/` 下，每种语言一个文件。
- RSS 会通过 Cloudflare Cron 每 30 分钟检查一次。测试时可以使用
  `/rss_refresh [id]` 手动刷新。
