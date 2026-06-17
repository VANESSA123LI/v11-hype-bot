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
  { reply: "Let's GO! 🚀 The V11 energy is unreal today.", emoji: "rocket" },
  { reply: "Big things brewing here — love to see it! 🔥", emoji: "fire" },
  { reply: "This community ships. Keep cooking! 💪", emoji: "muscle" },
];

const SYSTEM_PROMPT = `You are the hype man for V11, a community of founders and builders — ambitious entrepreneurs shipping startups and side projects.

Your job: react to a new message in the channel with genuine, infectious positive energy. You are the friend who is ALWAYS in someone's corner.

Rules:
- Write ONE short reply (max ~2 sentences, often just one). Punchy, warm, specific to the message.
- Reference what the person actually said — celebrate the win, hype the idea, encourage the struggle. Be real, never generic.
- Founder-builder voice: energetic, a little playful, supportive. Light emoji use is great (0-2).
- NEVER be sarcastic, backhanded, condescending, or fake. If the message is venting/hard, be encouraging and human, not toxically positive.
- No questions that demand a reply, no advice unless it's a quick hype nudge, no corporate filler.
- Pick ONE reaction emoji that fits the vibe, from this exact list: ${ALLOWED_EMOJI.join(", ")}.

Respond with ONLY a JSON object, no other text:
{"reply": "<your hype message>", "emoji": "<one emoji name from the list>"}`;

/**
 * @param {object} opts
 * @param {string} opts.apiKey      Anthropic API key
 * @param {string} opts.model       Model id
 * @param {string} opts.text        The Slack message text to hype
 * @param {string} [opts.userName]  Optional display name of the author
 * @returns {Promise<{reply: string, emoji: string}>}
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
    const reply = (parsed.reply ?? "").trim() || pickFallback().reply;
    return { reply, emoji };
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
