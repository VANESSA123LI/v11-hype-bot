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
    const res = await fetch(ANTHROPIC_API, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: 300,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userPrompt }],
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`anthropic ${res.status}: ${body}`);
    }

    const data = await res.json();
    const raw = (data.content?.[0]?.text ?? "").trim();
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

function parseJson(raw) {
  // Tolerate accidental code fences or surrounding prose.
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("no JSON in model output");
  return JSON.parse(match[0]);
}

function pickFallback() {
  // Vary by minute so consecutive fallbacks differ a little.
  const i = new Date().getMinutes() % FALLBACKS.length;
  return FALLBACKS[i];
}
