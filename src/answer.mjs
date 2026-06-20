// Answer a user's query when the bot is tagged or replied to in a thread.
// Unlike hype mode, this reads thread context and replies with a plain,
// helpful message (no emoji-JSON envelope).

import { callClaude } from "./anthropic.mjs";

const SYSTEM_PROMPT = `You are the V11 bot, a helpful member of V11 — a community of founders and builders shipping startups and side projects.

You're normally the channel's hype man, but right now someone has tagged you or replied to you directly with a question or request. Answer it.

Rules:
- Be genuinely helpful and direct. Actually answer the question or do what's asked.
- Keep the founder-builder voice: warm, energetic, concise. A little hype is fine, but substance first.
- Use the thread context to understand what's being discussed before you answer.
- If you don't know something or can't do it, say so plainly — never make things up.
- Keep it to a one or two sentences unless the question genuinely needs more. No corporate filler. Do not be verbose.
- Plain text only (Slack formatting is fine). Do not wrap your answer in JSON or code fences.`;

const FALLBACK =
  "Sorry, I hit a snag answering that — mind trying again in a sec?";

/**
 * @param {object} opts
 * @param {string}  opts.apiKey      Anthropic API key
 * @param {string}  opts.model       Model id
 * @param {string}  opts.text        The triggering message text
 * @param {Array}   [opts.thread]    Prior thread messages ([{ user, text }, ...]), oldest first
 * @param {string}  [opts.botUserId] The bot's own user id (to label its turns)
 * @returns {Promise<string>} The reply text.
 */
export async function generateAnswer({ apiKey, model, text, thread, botUserId }) {
  try {
    const context = formatThread(thread, botUserId);
    const userPrompt = context
      ? `Here is the thread so far (oldest first):\n\n${context}\n\nThe latest message addressed to you is:\n"""${text}"""\n\nReply helpfully.`
      : `Someone sent you this message in the V11 channel:\n\n"""${text}"""\n\nReply helpfully.`;

    const reply = await callClaude({
      apiKey,
      model,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }],
      maxTokens: 600,
    });

    return reply || FALLBACK;
  } catch (err) {
    console.error("generateAnswer failed, using fallback:", err.message);
    return FALLBACK;
  }
}

/** Render thread messages as a readable transcript for the prompt. */
function formatThread(thread, botUserId) {
  if (!Array.isArray(thread) || thread.length === 0) return "";
  return thread
    .filter((m) => m.text && m.text.trim())
    .map((m) => {
      const who = m.user === botUserId ? "You (the bot)" : `User ${m.user ?? "?"}`;
      return `${who}: ${m.text.trim()}`;
    })
    .join("\n");
}
