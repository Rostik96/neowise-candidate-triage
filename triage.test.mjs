import assert from "node:assert/strict";
import { once } from "node:events";
import { after, before, describe, it } from "node:test";
import { createTriageServer } from "./server.mjs";

const MANUAL_REVIEW = { status: "manual_review", topic: null, draft: null };
const DRAFT = "Спасибо за обращение. Уточним детали заявки.";

let server;
let base;

before(async () => {
  server = createTriageServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server.close();
  await once(server, "close");
});

async function post(body) {
  const response = await fetch(`${base}/api/triage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  return { status: response.status, json: await response.json() };
}

describe("POST /api/triage", () => {
  it("rejects empty, missing, and non-string input", async () => {
    const cases = [
      { text: "" },
      { text: " \n\t " },
      {},
      { text: 12 },
      { text: null },
      "{",
      "[]",
      "null",
    ];
    for (const body of cases) {
      const { status, json } = await post(body);
      assert.equal(status, 400, JSON.stringify(body));
      assert.deepEqual(json, { status: "invalid_input" });
    }
  });

  it("returns manual review when the model times out", async () => {
    const started = Date.now();
    const { status, json } = await post({ text: "заказ [timeout]" });
    const elapsed = Date.now() - started;
    assert.equal(status, 200);
    assert.deepEqual(json, MANUAL_REVIEW);
    assert.ok(elapsed < 1000, `model wait took ${elapsed}ms, expected the 300ms limit`);
  });

  it("returns manual review when the model fails or replies incorrectly", async () => {
    for (const text of [
      "заказ [error]",
      "заказ [bad-json]",
      "заказ [bad-topic]",
      "заказ [empty-draft]",
    ]) {
      const { status, json } = await post({ text });
      assert.equal(status, 200, text);
      assert.deepEqual(json, MANUAL_REVIEW);
    }
  });

  it("returns a topic and a non-empty draft for a normal request", async () => {
    const cases = [
      ["Когда будет доставка?", "delivery"],
      ["Какая цена?", "pricing"],
      ["Нужна консультация", "other"],
    ];
    for (const [text, topic] of cases) {
      const { status, json } = await post({ text });
      assert.equal(status, 200, text);
      assert.deepEqual(json, { status: "ready", topic, draft: DRAFT });
    }
  });
});
