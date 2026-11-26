import { createServer } from "node:http";
import { realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { classify } from "./mock-ai.mjs";

const html = await readFile(new URL("./index.html", import.meta.url));
const TOPICS = new Set(["delivery", "pricing", "other"]);
const MODEL_TIMEOUT_MS = 300;

function json(response, status, body) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

function invalidInput(response) {
  return json(response, 400, { status: "invalid_input" });
}

function manualReview(response) {
  return json(response, 200, { status: "manual_review", topic: null, draft: null });
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

function parseRequestText(raw) {
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  if (typeof body.text !== "string") return null;
  const text = body.text.trim();
  if (!text) return null;
  return text;
}

function parseModelResult(raw) {
  let result;
  try {
    result = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!result || typeof result !== "object" || Array.isArray(result)) return null;
  if (!TOPICS.has(result.topic)) return null;
  if (typeof result.draft !== "string" || !result.draft.trim()) return null;
  return { topic: result.topic, draft: result.draft };
}

async function handleTriage(request, response) {
  const text = parseRequestText(await readBody(request));
  if (text === null) return invalidInput(response);

  try {
    const raw = await classify(text, { signal: AbortSignal.timeout(MODEL_TIMEOUT_MS) });
    const result = parseModelResult(raw);
    if (!result) return manualReview(response);
    return json(response, 200, {
      status: "ready",
      topic: result.topic,
      draft: result.draft,
    });
  } catch {
    return manualReview(response);
  }
}

export function createTriageServer() {
  return createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/") {
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(html);
      return;
    }
    if (request.method !== "POST" || request.url !== "/api/triage")
      return json(response, 404, { status: "not_found" });
    try {
      await handleTriage(request, response);
    } catch {
      if (!response.headersSent)
        json(response, 500, { status: "server_error" });
    }
  });
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(realpathSync(entry)).href)
  createTriageServer().listen(Number(process.env.PORT || 3000), "127.0.0.1");
