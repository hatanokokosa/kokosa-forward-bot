set shell := ["fish", "-c"]

# List available recipes
default:
    @just --list

# Format (Prettier)
fmt:
    bun run format

# Type check
typecheck:
    bun run typecheck

# Tail Worker logs with Node-based Wrangler
tail:
    nix shell nixpkgs#nodejs -c npx wrangler tail

# Register webhook and commands
reg url secret:
    curl -X POST {{ url }}/registerWebhook -H "X-Admin-Secret: {{ secret }}"
    curl -X POST {{ url }}/registerCommands -H "X-Admin-Secret: {{ secret }}"
