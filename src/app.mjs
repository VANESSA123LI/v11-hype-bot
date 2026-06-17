// V11 Hype Bot — AWS Lambda handler (Slack Events API webhook).
//
// Flow:
//   1. Slack POSTs an event to this Lambda's Function URL.
//   2. We verify the signature, ack within Slack's 3s window, and
//      asynchronously re-invoke ourselves to do the slow work
//      (Claude call + Slack reaction + reply) without blocking the ack.
//
// One function, two modes:
//   - HTTP mode   : invoked by the Function URL (has `requestContext`).
//   - Worker mode : invoked by ourselves with `{ __async: true, slackEvent }`.

import { LambdaClient, InvokeCommand } from "@aws-sdk/client-lambda";
import { verifySlackSignature, postMessage, addReaction } from "./slack.mjs";
import { generateHype } from "./hype.mjs";

const {
  SLACK_BOT_TOKEN,
  SLACK_SIGNING_SECRET,
  ANTHROPIC_API_KEY,
  ANTHROPIC_MODEL = "claude-haiku-4-5",
  TARGET_CHANNEL_ID = "", // optional: restrict to one channel (the V11 channel)
  AWS_LAMBDA_FUNCTION_NAME,
} = process.env;

const lambda = new LambdaClient({});

export async function handler(event) {
  // --- Worker mode: do the actual hype work. ---
  if (event && event.__async) {
    await processMessage(event.slackEvent);
    return { ok: true };
  }

  // --- HTTP mode: validate + ack fast. ---
  const headers = lowerKeys(event.headers || {});
  const rawBody = event.isBase64Encoded
    ? Buffer.from(event.body || "", "base64").toString("utf8")
    : event.body || "";

  if (!verifySlackSignature(SLACK_SIGNING_SECRET, headers, rawBody)) {
    return reply(401, "invalid signature");
  }

  let body;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return reply(400, "bad json");
  }

  // Slack URL verification handshake (one-time, when you set the URL).
  if (body.type === "url_verification") {
    return reply(200, body.challenge);
  }

  // Slack retries delivery on timeout. We dedupe by ignoring retries —
  // the async worker will still finish the original.
  if (headers["x-slack-retry-num"]) {
    return reply(200, "ok (retry ignored)");
  }

  if (body.type === "event_callback" && shouldHype(body.event)) {
    // Fire-and-forget: re-invoke ourselves async, then ack immediately.
    await lambda.send(
      new InvokeCommand({
        FunctionName: AWS_LAMBDA_FUNCTION_NAME,
        InvocationType: "Event", // async
        Payload: Buffer.from(
          JSON.stringify({ __async: true, slackEvent: body.event })
        ),
      })
    );
  }

  return reply(200, "ok");
}

/** Decide whether a message event deserves hype. */
function shouldHype(e) {
  if (!e || e.type !== "message") return false;
  // Skip edits, deletes, joins, channel system messages, etc.
  if (e.subtype) return false;
  // Skip anything posted by a bot (including ourselves) to avoid loops.
  if (e.bot_id) return false;
  // Only hype top-level messages, not every thread reply.
  if (e.thread_ts && e.thread_ts !== e.ts) return false;
  // Need actual text to react to.
  if (!e.text || !e.text.trim()) return false;
  // Optionally restrict to the V11 channel.
  if (TARGET_CHANNEL_ID && e.channel !== TARGET_CHANNEL_ID) return false;
  return true;
}

/** The slow path: generate hype, react, and reply in-thread. */
async function processMessage(e) {
  try {
    const { reply: hypeText, emoji } = await generateHype({
      apiKey: ANTHROPIC_API_KEY,
      model: ANTHROPIC_MODEL,
      text: e.text,
    });

    // React on the original message; reply in its thread.
    await Promise.allSettled([
      addReaction(SLACK_BOT_TOKEN, {
        channel: e.channel,
        timestamp: e.ts,
        name: emoji,
      }),
      postMessage(SLACK_BOT_TOKEN, {
        channel: e.channel,
        text: hypeText,
        thread_ts: e.ts,
      }),
    ]);
  } catch (err) {
    console.error("processMessage failed:", err);
  }
}

function lowerKeys(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj)) out[k.toLowerCase()] = v;
  return out;
}

function reply(statusCode, body) {
  return { statusCode, headers: { "Content-Type": "text/plain" }, body };
}
