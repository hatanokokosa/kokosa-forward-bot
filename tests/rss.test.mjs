import assert from "node:assert/strict";
import { test } from "node:test";
import { addRssFeed, refreshRssFeeds } from "../src/rss.ts";

function createScenario() {
  const values = new Map();
  const kv = {
    async get(key, options) {
      const value = values.get(key);
      return value === undefined ? null : options?.type === "json" ? JSON.parse(value) : value;
    },
    async put(key, value) { values.set(key, value); },
    async delete(key) { values.delete(key); },
    async list({ prefix }) {
      return { keys: [...values.keys()].filter((key) => key.startsWith(prefix)).map((name) => ({ name })) };
    },
  };
  let ids = Array.from({ length: 60 }, (_, index) => 60 - index);
  const delivered = [];
  let rejectedId;
  const telegram = {
    async sendMessage({ text }) {
      const id = Number(text.match(/Article (\d+)/)[1]);
      if (id === rejectedId) return { ok: false };
      delivered.push(id);
      return { ok: true, result: {} };
    },
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(
    `<rss><channel><title>Long feed</title>${ids.map((id) => `<item><title>Article ${id}</title><guid>${id}</guid><link>https://example.com/${id}</link><description>Content ${id}</description></item>`).join("")}</channel></rss>`,
  );
  return {
    values, kv, delivered,
    setIds(next) { ids = next; },
    reject(id) { rejectedId = id; },
    add: () => addRssFeed(kv, "https://example.com/rss"),
    refresh: () => refreshRssFeeds(kv, telegram, { ENV_ADMIN_UID: "1" }),
    restore() { globalThis.fetch = originalFetch; },
  };
}

test("subscription seeds every existing article in a feed longer than 50 items", async () => {
  const scenario = createScenario();
  try {
    await scenario.add();
    for (let index = 0; index < 4; index++) {
      const result = await scenario.refresh();
      assert.deepEqual(result.errors, []);
      assert.equal(result.sent, 0);
    }
    assert.deepEqual(scenario.delivered, []);
  } finally { scenario.restore(); }
});

test("legacy truncated history converges without repeatedly sending old articles", async () => {
  const scenario = createScenario();
  try {
    const { feed } = await scenario.add();
    const key = `rss:seen:${feed.id}`;
    scenario.values.set(key, JSON.stringify(JSON.parse(scenario.values.get(key)).slice(0, 50)));
    for (let index = 0; index < 20; index++) await scenario.refresh();
    assert.equal(scenario.delivered.length, 10);
    assert.equal(new Set(scenario.delivered).size, 10);
    assert.equal((await scenario.refresh()).sent, 0);
  } finally { scenario.restore(); }
});

test("new article backlog drains once and failed deliveries remain retryable", async () => {
  const scenario = createScenario();
  try {
    await scenario.add();
    scenario.setIds(Array.from({ length: 67 }, (_, index) => 67 - index));
    scenario.reject(65);
    assert.equal((await scenario.refresh()).sent, 4);
    scenario.reject(undefined);
    assert.equal((await scenario.refresh()).sent, 3);
    assert.equal((await scenario.refresh()).sent, 0);
    assert.deepEqual([...scenario.delivered].sort((a, b) => a - b), [61, 62, 63, 64, 65, 66, 67]);
  } finally { scenario.restore(); }
});
