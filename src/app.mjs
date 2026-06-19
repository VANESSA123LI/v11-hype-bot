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
import {
  verifySlackSignature,
  postMessage,
  addReaction,
  getBotUserId,
  getThreadReplies,
} from "./slack.mjs";
import { generateHype, generateReply } from "./hype.mjs";

const {
  SLACK_BOT_TOKEN,
  SLACK_SIGNING_SECRET,
  ANTHROPIC_API_KEY,
  ANTHROPIC_MODEL = "claude-haiku-4-5",
  TARGET_CHANNEL_ID = "", // optional: restrict to one channel (the V11 channel)
  AWS_LAMBDA_FUNCTION_NAME,
} = process.env;

const lambda = new LambdaClient({});

// Resolve and cache the bot's own user id (so we can detect @mentions of it).
// Cached across warm invocations; one auth.test per cold start.
let cachedBotUserId = null;
async function botUserId() {
  if (cachedBotUserId === null) {
    try {
      cachedBotUserId = await getBotUserId(SLACK_BOT_TOKEN);
    } catch (err) {
      console.error("auth.test failed:", err.message);
      cachedBotUserId = "";
    }
  }
  return cachedBotUserId;
}

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

  if (body.type === "event_callback" && shouldForward(body.event)) {
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

/** Cheap HTTP-path pre-filter: is this event worth handing to the worker? */
function shouldForward(e) {
  if (!e || e.type !== "message") return false;
  // Skip edits, deletes, joins, channel system messages, etc.
  if (e.subtype) return false;
  // Skip anything posted by a bot (including ourselves) to avoid loops.
  if (e.bot_id) return false;
  // Need actual text to work with.
  if (!e.text || !e.text.trim()) return false;
  // Optionally restrict to the V11 channel.
  if (TARGET_CHANNEL_ID && e.channel !== TARGET_CHANNEL_ID) return false;
  // Everything else goes to the worker. Top-level posts get ambient hype;
  // thread replies are forwarded too so the worker can check whether Buddy is
  // part of the thread (it answers replies in its own threads, tagged or not).
  return true;
}

/**
 * The slow path. Two modes:
 *   - Interactive: Buddy is tagged (@Buddy), OR someone replies in a thread
 *     Buddy is already part of. Answer the question/comment, using the thread
 *     as context.
 *   - Ambient: a fresh top-level post — always react; reply only if warranted.
 */
async function processMessage(e) {
  try {
    const me = await botUserId();
    const mentioned = me && e.text.includes(`<@${me}>`);
    const isThreadReply = e.thread_ts && e.thread_ts !== e.ts;

    // Pull thread context when the message lives in a thread. Never let a
    // context-fetch failure block a reply — degrade to no context instead.
    let thread = [];
    if (isThreadReply) {
      try {
        thread = await getThreadReplies(SLACK_BOT_TOKEN, {
          channel: e.channel,
          ts: e.thread_ts,
        });
      } catch (err) {
        console.error("getThreadReplies failed, continuing without context:", err.message);
      }
    }

    // Interactive if tagged anywhere, or an untagged reply in a thread Buddy is
    // already in (someone is talking to it). Otherwise an unrelated thread reply.
    const botInThread = me && thread.some((m) => m.user === me);
    const interactive = mentioned || (isThreadReply && botInThread);
    if (isThreadReply && !interactive) return;

    // Reply into the existing thread if there is one, else start one.
    const threadTs = e.thread_ts || e.ts;

    if (interactive) {
      // --- Interactive mode: answer the member, using the thread for context. ---
      const question = me ? e.text.split(`<@${me}>`).join(" ").trim() : e.text.trim();
      const { emoji, reply: answer } = await generateReply({
        apiKey: ANTHROPIC_API_KEY,
        model: ANTHROPIC_MODEL,
        text: question,
        thread,
        botUserId: me,
      });
      await Promise.allSettled([
        addReaction(SLACK_BOT_TOKEN, {
          channel: e.channel,
          timestamp: e.ts,
          name: emoji,
        }),
        postMessage(SLACK_BOT_TOKEN, {
          channel: e.channel,
          text: answer,
          thread_ts: threadTs,
        }),
      ]);
      return;
    }

    // --- Ambient hype mode: always react, reply only when warranted. ---
    const { emoji, shouldReply, reply: hypeText } = await generateHype({
      apiKey: ANTHROPIC_API_KEY,
      model: ANTHROPIC_MODEL,
      text: e.text,
    });

    const tasks = [
      addReaction(SLACK_BOT_TOKEN, {
        channel: e.channel,
        timestamp: e.ts,
        name: emoji,
      }),
    ];
    if (shouldReply) {
      tasks.push(
        postMessage(SLACK_BOT_TOKEN, {
          channel: e.channel,
          text: hypeText,
          thread_ts: threadTs,
        })
      );
    }
    await Promise.allSettled(tasks);
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
