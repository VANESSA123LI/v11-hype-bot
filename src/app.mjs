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
  getRecentBotPosts,
} from "./slack.mjs";
import { generateHype, generateReply } from "./hype.mjs";
import { generateQuestion } from "./discussion.mjs";

const {
  SLACK_BOT_TOKEN,
  SLACK_SIGNING_SECRET,
  ANTHROPIC_API_KEY,
  ANTHROPIC_MODEL = "claude-haiku-4-5",
  TARGET_CHANNEL_ID = "", // optional: restrict to one channel (the V11 channel)
  RANDOM_CHANNEL_ID = "", // #random — where scheduled discussion questions post
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
  // --- Cron mode: EventBridge schedule fires us to post a discussion question. ---
  if (event && event.__cron === "discussion") {
    await postDiscussionQuestion();
    return { ok: true };
  }

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
 *   - Interactive: Buddy is tagged (@Buddy). Answer the question/comment, using
 *     the thread as context. Buddy only speaks inside threads when tagged.
 *   - Ambient: a fresh top-level post — always react; reply only if warranted.
 */
async function processMessage(e) {
  try {
    const me = await botUserId();
    const mentioned = me && e.text.includes(`<@${me}>`);
    const isThreadReply = e.thread_ts && e.thread_ts !== e.ts;

    // Only engage in threads when explicitly tagged. Never auto-reply to thread
    // chatter — including replies under Buddy's own posts/questions.
    if (isThreadReply && !mentioned) return;

    // Reply into the existing thread if there is one, else start one.
    const threadTs = e.thread_ts || e.ts;

    if (mentioned) {
      // Tagged: pull thread context (if any), then answer. Never let a
      // context-fetch failure block the reply — degrade to no context.
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

/**
 * Cron path: generate a fresh discussion-starter and post it (top-level) to
 * #random. Avoids repeating any of the bot's own questions from the last 60 days.
 */
async function postDiscussionQuestion() {
  if (!RANDOM_CHANNEL_ID) {
    console.error("postDiscussionQuestion: RANDOM_CHANNEL_ID not set; skipping");
    return;
  }
  try {
    const me = await botUserId();
    const sixtyDaysAgo = String(Math.floor(Date.now() / 1000) - 60 * 24 * 60 * 60);
    let recentQuestions = [];
    try {
      recentQuestions = await getRecentBotPosts(SLACK_BOT_TOKEN, {
        channel: RANDOM_CHANNEL_ID,
        oldestTs: sixtyDaysAgo,
        botUserId: me,
      });
    } catch (err) {
      console.error("getRecentBotPosts failed, generating without dedup list:", err.message);
    }

    const question = await generateQuestion({
      apiKey: ANTHROPIC_API_KEY,
      model: ANTHROPIC_MODEL,
      recentQuestions,
    });

    await postMessage(SLACK_BOT_TOKEN, { channel: RANDOM_CHANNEL_ID, text: question });
    console.log(`posted discussion question (avoided ${recentQuestions.length} recent): ${question}`);
  } catch (err) {
    console.error("postDiscussionQuestion failed:", err);
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
