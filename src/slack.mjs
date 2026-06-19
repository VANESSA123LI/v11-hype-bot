// Slack helpers: request-signature verification + Web API calls.
// No SDK needed — Slack's Web API is plain HTTPS + JSON.

import crypto from "node:crypto";

const SLACK_API = "https://slack.com/api";

/**
 * Verify a Slack request signature.
 * https://api.slack.com/authentication/verifying-requests-from-slack
 *
 * @param {string} signingSecret  Slack app signing secret
 * @param {object} headers        Request headers (lowercased keys)
 * @param {string} rawBody        The EXACT raw request body string
 * @returns {boolean}
 */
export function verifySlackSignature(signingSecret, headers, rawBody) {
  const timestamp = headers["x-slack-request-timestamp"];
  const signature = headers["x-slack-signature"];
  if (!timestamp || !signature) return false;

  // Reject requests older than 5 minutes (replay protection).
  const fiveMinutes = 60 * 5;
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > fiveMinutes) {
    return false;
  }

  const base = `v0:${timestamp}:${rawBody}`;
  const hmac = crypto
    .createHmac("sha256", signingSecret)
    .update(base)
    .digest("hex");
  const expected = `v0=${hmac}`;

  // Constant-time comparison.
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// Write methods (chat.postMessage, reactions.add) accept a JSON body.
async function slackCall(token, method, payload) {
  const res = await fetch(`${SLACK_API}/${method}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!data.ok) {
    // Don't throw on "already_reacted" — it's harmless.
    if (data.error === "already_reacted") return data;
    throw new Error(`slack ${method} failed: ${data.error}`);
  }
  return data;
}

// Read methods (conversations.replies, auth.test) don't parse a JSON body —
// their arguments must be query/form params. Send them as GET with a query string.
async function slackGet(token, method, params = {}) {
  const qs = new URLSearchParams(params).toString();
  const url = qs ? `${SLACK_API}/${method}?${qs}` : `${SLACK_API}/${method}`;
  const res = await fetch(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await res.json();
  if (!data.ok) throw new Error(`slack ${method} failed: ${data.error}`);
  return data;
}

/** Post a message, optionally as a threaded reply. */
export function postMessage(token, { channel, text, thread_ts }) {
  return slackCall(token, "chat.postMessage", { channel, text, thread_ts });
}

/** Add an emoji reaction to a message. `name` is without colons. */
export function addReaction(token, { channel, timestamp, name }) {
  return slackCall(token, "reactions.add", { channel, timestamp, name });
}

/** Resolve the bot's own user id (used to ignore its own messages). */
export async function getBotUserId(token) {
  const data = await slackGet(token, "auth.test");
  return data.user_id;
}

/**
 * Fetch the messages of a thread, oldest first.
 * `ts` is the thread root (a message's `thread_ts`).
 */
export async function getThreadReplies(token, { channel, ts }) {
  const data = await slackGet(token, "conversations.replies", {
    channel,
    ts,
    limit: "50",
  });
  return data.messages ?? [];
}
