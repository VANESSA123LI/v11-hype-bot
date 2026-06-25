// Generate a hype reply + reaction emoji using Claude.
// Uses the Anthropic Messages API directly via fetch (no SDK dependency).

import { VOICE } from "./voice.mjs";

const ANTHROPIC_API = "https://api.anthropic.com/v1/messages";

// Curated set of upbeat standard Slack emoji the bot is allowed to react with.
// Constraining the model keeps reactions to valid emoji names.
const ALLOWED_EMOJI = [
  "fire",
  "rocket",
  "tada",
  "raised_hands",
  "muscle",
  "100",
  "star-struck",
  "clap",
  "zap",
  "trophy",
  "sparkles",
  "sunglasses",
  "boom",
  "chart_with_upwards_trend",
  "heart",
  "eyes",
  "rolling_on_the_floor_laughing",
  "saluting_face",
  "partying_face",
  "bulb",
];

const FALLBACKS = [
  { reply: "Let's GO! 🚀 The V11 energy is unreal today.", emoji: "rocket", shouldReact: true, shouldReply: true },
  { reply: "Big things brewing here — love to see it! 🔥", emoji: "fire", shouldReact: true, shouldReply: true },
  { reply: "This community ships. Keep cooking! 💪", emoji: "muscle", shouldReact: true, shouldReply: true },
];

const SYSTEM_PROMPT = `You are the hype man for V11, an entrepreneurial society — a tight-knit community of ambitious builders and founders shipping startups, side projects, and bold ideas. V11 was founded by Vatsalya and Jasper. The people here are doers: they build, they ship, they back each other. Your job is to amplify that energy.

Be the friend who's in someone's corner — but SPARINGLY. Most messages should get nothing from you. Only step in for moments that actually matter; reacting to everything is noise.

For each message, decide two things:

1. shouldReact — add an emoji reaction ONLY if this is a genuinely notable moment:
   - A real win, launch, milestone, or piece of good news (shipped, closed a customer, hit a goal, got into a program, etc.).
   - A bold, ambitious idea or plan.
   - Someone sharing a real struggle, setback, or vulnerable moment.
   For routine chatter — logistics, scheduling, links, FYIs, questions, "thanks", small talk, one-word messages — shouldReact = false. When in doubt, don't react. The default is no reaction.

2. shouldReply — post a short text reply only for the standout moments where words clearly add something (a big win/launch/milestone, or a struggle where encouragement really helps). This is rarer than reacting. If you reply, you should also react.

Reply rules (when you do reply):
${VOICE}
- Be specific to what they actually said — celebrate the win, hype the idea, back them up when it's hard. Never generic, never fake or toxically positive.
- 0-2 emoji is plenty.

Pick the emoji from this exact list: ${ALLOWED_EMOJI.join(", ")}.

Respond with ONLY a JSON object, no other text:
{"emoji": "<one emoji name from the list>", "shouldReact": <true or false>, "shouldReply": <true or false>, "reply": "<your hype message, or empty string if shouldReply is false>"}`;

/**
 * @param {object} opts
 * @param {string} opts.apiKey      Anthropic API key
 * @param {string} opts.model       Model id
 * @param {string} opts.text        The Slack message text to hype
 * @param {string} [opts.userName]  Optional display name of the author
 * @returns {Promise<{emoji: string, shouldReact: boolean, shouldReply: boolean, reply: string}>}
 */
export async function generateHype({ apiKey, model, text, userName }) {
  const who = userName ? `${userName} just posted` : "Someone just posted";
  const userPrompt = `${who} this message in the V11 channel:\n\n"""${text}"""\n\nDecide whether it's worth reacting to or replying to.`;

  try {
    const raw = await callClaude({
      apiKey,
      model,
      system: SYSTEM_PROMPT,
      userPrompt,
      maxTokens: 300,
    });
    const parsed = parseJson(raw);

    const emoji = ALLOWED_EMOJI.includes(parsed.emoji) ? parsed.emoji : "fire";
    const reply = (parsed.reply ?? "").trim();
    // Reply only when the model says it's warranted AND actually wrote something.
    const shouldReply = parsed.shouldReply === true && reply.length > 0;
    // React only on notable messages; always react if we're replying.
    const shouldReact = parsed.shouldReact === true || shouldReply;
    return { emoji, shouldReact, shouldReply, reply };
  } catch (err) {
    console.error("generateHype failed, using fallback:", err.message);
    return pickFallback();
  }
}

const ANSWER_SYSTEM_PROMPT = `You're Buddy, part of V11 — a community of founders and builders (founded by Vatsalya and Jasper). Someone tagged you or replied to you. Help them out like a sharp friend would.

${VOICE}

A few more things:
- Actually answer the question or do the thing — substance over hype.
- If you don't know, or it needs info you can't have, just say so. Don't make stuff up.
- Only go long if the question genuinely needs it. Most don't.
- Slack formatting only: *bold*, _italics_, \`code\`, bullet lists. No # headers.
- Pick ONE reaction emoji from: ${ALLOWED_EMOJI.join(", ")}.

Respond with ONLY a JSON object, no other text:
{"emoji": "<one emoji name from the list>", "reply": "<your response>"}`;

/**
 * Interactive mode: answer a member who tagged Buddy, or replied in a thread
 * Buddy is part of. Always returns a reply (Buddy never ignores a direct turn).
 *
 * @param {object} opts
 * @param {string}  opts.apiKey
 * @param {string}  opts.model
 * @param {string}  opts.text        The member's message (with the @Buddy mention removed)
 * @param {Array}   [opts.thread]    Prior thread messages ([{ user, text }, ...]), oldest first
 * @param {string}  [opts.botUserId] Buddy's own user id (to label its turns)
 * @returns {Promise<{emoji: string, reply: string}>}
 */
export async function generateReply({ apiKey, model, text, thread, botUserId }) {
  const context = formatThread(thread, botUserId);
  const userPrompt = context
    ? `Here's the thread so far (oldest first):\n\n${context}\n\nThe member just turned to you and said:\n\n"""${text}"""\n\nRespond, using the thread for context.`
    : `A V11 member tagged you and said:\n\n"""${text}"""\n\nRespond.`;
  try {
    const raw = await callClaude({
      apiKey,
      model,
      system: ANSWER_SYSTEM_PROMPT,
      userPrompt,
      maxTokens: 800,
    });
    const parsed = parseJson(raw);
    const emoji = ALLOWED_EMOJI.includes(parsed.emoji) ? parsed.emoji : "raised_hands";
    const reply =
      (parsed.reply ?? "").trim() ||
      "Hey! I'm here — ask me anything and I'll do my best. 🙌";
    return { emoji, reply };
  } catch (err) {
    console.error("generateReply failed, using fallback:", err.message);
    return {
      emoji: "raised_hands",
      reply: "Hey! I'm here — got a little tangled up just now, try me again? 🙌",
    };
  }
}

/** Shared call to the Anthropic Messages API. Returns the raw text content. */
export async function callClaude({ apiKey, model, system, userPrompt, maxTokens }) {
  const res = await fetch(ANTHROPIC_API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      system,
      messages: [{ role: "user", content: userPrompt }],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`anthropic ${res.status}: ${body}`);
  }

  const data = await res.json();
  return (data.content?.[0]?.text ?? "").trim();
}

function parseJson(raw) {
  // Tolerate accidental code fences or surrounding prose.
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("no JSON in model output");
  return JSON.parse(match[0]);
}

/** Render thread messages as a readable transcript for the prompt. */
function formatThread(thread, botUserId) {
  if (!Array.isArray(thread) || thread.length === 0) return "";
  return thread
    .filter((m) => m.text && m.text.trim())
    .map((m) => {
      const who = m.user === botUserId ? "You (Buddy)" : `User ${m.user ?? "?"}`;
      return `${who}: ${m.text.trim()}`;
    })
    .join("\n");
}

function pickFallback() {
  // Vary by minute so consecutive fallbacks differ a little.
  const i = new Date().getMinutes() % FALLBACKS.length;
  return FALLBACKS[i];
}
