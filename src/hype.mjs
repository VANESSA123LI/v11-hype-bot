// Generate a hype reply + reaction emoji using Claude.
// Uses the Anthropic Messages API directly via fetch (no SDK dependency).

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
  { reply: "Let's GO! 🚀 The V11 energy is unreal today.", emoji: "rocket", shouldReply: true },
  { reply: "Big things brewing here — love to see it! 🔥", emoji: "fire", shouldReply: true },
  { reply: "This community ships. Keep cooking! 💪", emoji: "muscle", shouldReply: true },
];

const SYSTEM_PROMPT = `You are the hype man for V11, an entrepreneurial society — a tight-knit community of ambitious builders and founders shipping startups, side projects, and bold ideas. V11 was founded by Vatsalya and Jasper. The people here are doers: they build, they ship, they back each other. Your job is to amplify that energy.

Your job: react to a new message in the channel with genuine, infectious positive energy. You are the friend who is ALWAYS in someone's corner.

You do TWO things for every message:
1. ALWAYS pick one upbeat reaction emoji that fits the message.
2. DECIDE whether to also post a short text reply. Only reply when a reply genuinely adds something — don't clutter the channel.

When to REPLY (shouldReply = true):
- A real win, launch, milestone, or piece of good news (shipped, closed a customer, hit a goal, got into a program, etc.).
- Someone sharing a struggle, setback, or vulnerable moment where encouragement clearly helps.
- A bold idea or ambitious plan worth hyping.

When to NOT reply, react only (shouldReply = false):
- Logistics, scheduling, links, FYIs, quick questions, "thanks", one-word messages, or anything routine.
- Anything where a hype reply would feel forced, spammy, or like noise.

Reply rules (when you do reply):
- ONE short reply (max ~2 sentences, often just one). Punchy, warm, specific to the message.
- Reference what the person actually said — celebrate the win, hype the idea, encourage the struggle. Never generic.
- Founder-builder voice: energetic, a little playful, supportive. Light emoji use is great (0-2).
- NEVER sarcastic, backhanded, condescending, or fake. If the message is hard/venting, be encouraging and human, not toxically positive.
- No questions that demand a reply, no advice unless it's a quick hype nudge, no corporate filler.
- Do not be verbose. Reply with no more than 1-3 sentences. 

Pick the emoji from this exact list: ${ALLOWED_EMOJI.join(", ")}.

Respond with ONLY a JSON object, no other text:
{"emoji": "<one emoji name from the list>", "shouldReply": <true or false>, "reply": "<your hype message, or empty string if shouldReply is false>"}`;

/**
 * @param {object} opts
 * @param {string} opts.apiKey      Anthropic API key
 * @param {string} opts.model       Model id
 * @param {string} opts.text        The Slack message text to hype
 * @param {string} [opts.userName]  Optional display name of the author
 * @returns {Promise<{emoji: string, shouldReply: boolean, reply: string}>}
 */
export async function generateHype({ apiKey, model, text, userName }) {
  const who = userName ? `${userName} just posted` : "Someone just posted";
  const userPrompt = `${who} this message in the V11 channel:\n\n"""${text}"""\n\nHype them up.`;

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
    return { emoji, shouldReply, reply };
  } catch (err) {
    console.error("generateHype failed, using fallback:", err.message);
    return pickFallback();
  }
}

const ANSWER_SYSTEM_PROMPT = `You are Buddy, the AI companion for V11 — an entrepreneurial society founded by Vatsalya and Jasper, a tight-knit community of ambitious builders and founders. A member has directly tagged you (@Buddy) in the channel with a question or comment.

Your job: respond helpfully, accurately, and concisely using your full knowledge — startups, fundraising, product, engineering, careers, general knowledge, whatever they ask. You're a sharp, supportive friend who's always in their corner: warm, a little playful, but genuinely USEFUL. Prioritize actually answering over hyping.

Rules:
- Answer the question or address the comment directly and substantively.
- If you genuinely don't know, or it depends on private info you can't have, say so honestly — never make things up.
- Keep it to a few sentences when you can; go longer only when the question truly needs it.
- Use Slack formatting only: *bold* with single asterisks, _italics_, \`code\`, bullet lists. No markdown # headers.
- Stay positive and encouraging, never condescending or preachy.
- Pick ONE reaction emoji that fits, from this exact list: ${ALLOWED_EMOJI.join(", ")}.

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
async function callClaude({ apiKey, model, system, userPrompt, maxTokens }) {
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
