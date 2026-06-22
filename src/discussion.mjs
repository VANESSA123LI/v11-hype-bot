// Discussion-starter questions for #random, plus light engagement in the threads.
//
// generateQuestion(): produces ONE fresh question per call, steering Claude away
// from the last ~60 days of the bot's own questions; falls back to a curated,
// pre-screened bank if the API call fails. System prompt + bank were generated
// and adversarially screened for the V11 #random channel.

import { callClaude } from "./hype.mjs";
import { VOICE } from "./voice.mjs";

const SYSTEM_PROMPT = `You are the question engine for "Buddy," a friendly Slack #random bot for V11, a community of startup founders and builders. Every other day you post ONE fun discussion-starter to spark casual conversation, opinions, and light playful debate.

YOUR TASK
Output exactly ONE fresh discussion-starter question. Return ONLY the question text — no preamble, no quotes, no emojis, no labels, no explanation.

HARD CONSTRAINTS (every question must obey all of these)
- 1-2 sentences MAX. Concise and punchy.
- Casual, friendly, and answerable by ANYONE with zero niche or technical expertise.
- Invites many different answers and opinions. Avoid dead-end yes/no questions UNLESS the question clearly sparks fun debate (e.g. "is a hot dog a sandwich?").
- STRICTLY AVOID anything controversial, sensitive, or divisive: no politics, religion, money/salary/wealth shaming, relationship drama, dating, tragedy, death, illness or health conditions, body image, alcohol/drugs, or anything that could make someone feel excluded or uncomfortable.
- Friendly, warm, inclusive tone. Universally relatable — assume a global audience with varied backgrounds.
- Keep it light. When in doubt, pick the more wholesome, playful option.

TOPIC ROTATION
Rotate across these categories so the channel stays varied. Pick a category that is NOT heavily represented in the recent questions list below, then write one question in it:
- Sports & games (watching or playing)
- Movies & TV
- Music
- Video games & board games
- Food & drink
- Travel & places
- Technology & gadgets
- Nostalgia & childhood
- Hypotheticals, superpowers & "would you rather"

STYLE ANCHORS (match this vibe and length)
- "What's the greatest video game of all time?"
- "If you could instantly master one skill, what would it be?"
- "What's a movie everyone loves that you just couldn't get into?"
- "What's the best snack ever invented?"
- "Which fictional world would you most want to live in?"
- "What's a piece of technology you can't imagine living without?"

FRESHNESS
A list of RECENT QUESTIONS will be appended below. Your output MUST be meaningfully different from every recent question — not a reworded duplicate, not the same core idea with swapped words. Choose a different topic and angle. If many recent questions cluster in one or two categories, deliberately pick an underused category.

OUTPUT
Return only the single question, as plain text on one line.`;

// Diverse exemplars embedded in the prompt as style anchors.
const FEW_SHOT = [
  "What's the one food you could eat every single day and never get tired of?",
  "If startups had an Olympics, what would the events be and who's taking home gold?",
  "What's a movie everyone raves about that you just couldn't get into?",
  "If you could only listen to one album for the rest of the year, what would it be?",
  "What video game world would you actually want to live in for a week?",
  "If you could teleport anywhere in the world for the next 24 hours, where are you going?",
  "What's a piece of tech you'd genuinely cry over if it broke?",
  "What show did you rush home from school to watch as a kid?",
  "You get one superpower, but it only works on Mondays. Which one are you picking?",
  "Be honest: is a hot dog a sandwich? Defend your answer."
];

// Curated, deduped, controversy-screened fallback bank (used if the API fails).
const QUESTION_BANK = [
  "If you had to pick up one new sport tomorrow, what would you go for?",
  "What's a sport that totally deserves more love and attention than it gets?",
  "Pick your dream stadium or arena to catch a game in, anywhere in the world.",
  "What's the best underdog or upset moment you've ever seen in sports?",
  "Would you rather be unbeatable at one sport or pretty good at all of them?",
  "What's the most fun pickup or backyard game: basketball, soccer, ping pong, or something else?",
  "If you could attend one major event once in your life: Olympics, World Cup, or Super Bowl?",
  "What's the best team name or mascot in all of sports?",
  "If startups had an Olympics, what would the events be and who's taking home gold?",
  "What's your most rewatchable movie of all time, the one you'll always stop scrolling for?",
  "What's a TV show everyone raves about that you just couldn't get into?",
  "If you could only listen to one album for the rest of the year, what would it be?",
  "What movie has the best soundtrack ever made?",
  "What's a movie sequel that's actually better than the original?",
  "Which fictional TV character would you most want as a co-founder?",
  "What's the one TV show finale that totally stuck the landing for you?",
  "If your life had an opening theme song, what would it be?",
  "What's a movie you think is criminally underrated and more people should watch?",
  "Best plot twist that genuinely caught you off guard?",
  "Which decade had the best music, and why is it obviously the one you grew up in?",
  "What's the comfort show you put on when you just want background noise?",
  "If you could see one band or artist live (alive or not), who would it be?",
  "What's the greatest video game of all time, no debate (okay, maybe a little debate)?",
  "What game did you sink way too many hours into and have zero regrets about?",
  "Board games or video games for game night, and what's your go-to pick?",
  "What's the first video game you ever remember playing?",
  "What's the most satisfying win you've ever pulled off in a game?",
  "Cozy chill games or high-stakes competitive games: which camp are you in?",
  "What video game world would you actually want to live in for a week?",
  "What's a game soundtrack that lives rent-free in your head?",
  "What's the one food you could eat every single day and never get tired of?",
  "Pineapple on pizza: genius topping or a crime against humanity?",
  "What's the most underrated snack at the grocery store that more people should know about?",
  "If you could only drink one beverage besides water for the rest of your life, what would it be?",
  "What's a food combo that sounds weird but is actually amazing?",
  "Be honest: is a hot dog a sandwich? Defend your answer.",
  "What's your go-to comfort food after a long, brutal day?",
  "Cereal before or after milk? And while we're at it, is cereal a soup?",
  "What's the best thing you've ever cooked, even if it was a total accident?",
  "Coffee or tea person, and what's your exact order?",
  "What's a food from your childhood that instantly takes you back the moment you taste it?",
  "If you had to pick a last meal with no limits, what's on the plate?",
  "Sweet or savory breakfast, and what's the ultimate version of it?",
  "What's the most overrated travel destination you've been to?",
  "Window seat or aisle seat, and are you ready to defend your choice?",
  "If you could teleport to any one place right now for 24 hours, where are you going?",
  "What's the best meal you've ever had while traveling?",
  "Beach vacation or mountain getaway? Pick your side.",
  "What's a country or city that totally surprised you in the best way?",
  "What's the one item you absolutely cannot travel without?",
  "What's a city you'd happily live in for a month, no questions asked?",
  "Road trip or flight for a long journey: which do you actually enjoy?",
  "If money were no object, what's the one bucket-list trip you'd book tomorrow?",
  "What's your go-to move for surviving a long layover?",
  "What's a piece of tech you own that you'd genuinely cry over if it broke?",
  "What's an app on your phone you open way more times a day than you'd like to admit?",
  "Be honest: how many browser tabs do you have open right now?",
  "What's a gadget from the past (Game Boy, iPod, flip phone) you'd happily bring back?",
  "If your phone could only keep 3 apps forever, which ones survive the cut?",
  "What's a tech trend everyone's hyped about that you secretly don't get?",
  "What's the most useful piece of tech you own that cost under $20?",
  "Dark mode or light mode, and are you ready to defend your choice?",
  "What's an old piece of technology you still use even though there's a newer option?",
  "What's the first thing you ever built or hacked together, no matter how janky?",
  "Wired headphones vs. wireless earbuds: which side are you really on?",
  "What's a snack or drink from your childhood that you wish they still made today?",
  "What show did you rush home from school to watch as a kid?",
  "If you could relive one decade just for the vibes, which one are you picking?",
  "What's a toy from back in the day you'd lose your mind over if it came back?",
  "What song instantly teleports you straight back to being a teenager?",
  "What's something every kid did growing up that would totally baffle kids today?",
  "Cassette, CD, MP3, or vinyl: which one holds the most memories for you?",
  "What's a movie you watched on repeat as a kid that you can still quote word for word?",
  "Which long-gone store, restaurant, or hangout spot do you miss the most?",
  "What's a 'fact' you fully believed as a kid that turned out to be hilariously wrong?",
  "What's a song that instantly puts you in a good mood, every single time?",
  "Which fictional character would you actually want to grab a coffee with?",
  "What's a celebrity cameo or casting choice that totally surprised you in the best way?",
  "Book vs. movie: name one where the adaptation was somehow better than the original.",
  "What's a viral moment or meme from the last few years that still makes you laugh?",
  "Which fictional universe would you most want to actually live in for a week?",
  "You get one superpower, but it only works on Mondays. Which one are you picking?",
  "Would you rather have unlimited free flights for life or never have to pay for food again?",
  "If you could swap lives with any fictional character for a week, who are you becoming?",
  "You can add one extra hour to the day that nobody else gets. How are you spending it?",
  "Would you rather be able to talk to animals or speak every human language fluently?",
  "A genie grants you one totally useless superpower. What's the most fun pointless ability you'd ask for?",
  "If you could instantly become a world-class expert at any one hobby, which would you choose?",
  "Would you rather always know when someone is lying or always know the perfect thing to say?",
  "If you woke up tomorrow able to play any one instrument perfectly, which one are you picking?",
  "Would you rather have a rewind button for your day or a fast-forward button you can use once?",
  "You get to bring one fictional gadget into the real world. What's coming with you?",
  "If you could freeze time for everyone but yourself, what's the first thing you'd do?"
];

// Standard Slack emoji Buddy may react with in discussion threads.
const REPLY_EMOJI = [
  "fire", "eyes", "100", "sparkles", "raised_hands",
  "joy", "thinking_face", "heart", "clap", "tada",
];

/**
 * Generate one fresh discussion-starter question.
 * @param {object} opts
 * @param {string} opts.apiKey
 * @param {string} opts.model
 * @param {string[]} [opts.recentQuestions]  The bot's recent questions to avoid repeating.
 * @returns {Promise<string>}
 */
export async function generateQuestion({ apiKey, model, recentQuestions = [] }) {
  const examples = "\n\nExamples of the vibe and length:\n" + FEW_SHOT.map((q) => `- ${q}`).join("\n");
  const avoid = recentQuestions.length
    ? "\n\nRECENT QUESTIONS — do NOT repeat or reword any of these:\n" +
      recentQuestions.map((q, i) => `${i + 1}. ${q}`).join("\n")
    : "";
  try {
    const raw = await callClaude({
      apiKey,
      model,
      system: SYSTEM_PROMPT + examples,
      userPrompt: `Write today's single discussion-starter question now.${avoid}`,
      maxTokens: 120,
    });
    const q = cleanup(raw);
    if (q && !isRepeat(q, recentQuestions)) return q;
    return pickFromBank(recentQuestions);
  } catch (err) {
    console.error("generateQuestion failed, using bank:", err.message);
    return pickFromBank(recentQuestions);
  }
}

const ENGAGE_PROMPT = `You are Buddy, the friendly host of the #random channel for V11, a community of founders and builders. You posted a fun discussion question and people are weighing in.

You will see the thread: the first message is YOUR question, the rest are members' answers. Decide whether to chime in.

Chime in (shouldReply = true) when you can add energy: react to a spicy or surprising take, playfully push back to spark light debate, build on someone's answer, or ask a quick fun follow-up.

Do NOT reply (shouldReply = false) for routine "+1" / one-word agreement, or when you'd just be repeating yourself or cluttering the thread.

When you do reply:
${VOICE}
- Reference what someone actually said. Keep it warm and inclusive. No politics/religion/sensitive topics.
- Plain text. No markdown headers.

Pick ONE reaction emoji from: ${REPLY_EMOJI.join(", ")}.

Respond with ONLY a JSON object:
{"emoji": "<one emoji name>", "shouldReply": <true or false>, "reply": "<your one-line reply, or empty string>"}`;

/**
 * Decide whether/how Buddy engages with a reply in one of its discussion threads.
 * @returns {Promise<{emoji: string, shouldReply: boolean, reply: string}>}
 */
export async function generateDiscussionReply({ apiKey, model, thread, botUserId }) {
  const transcript = (thread || [])
    .filter((m) => m.text && m.text.trim())
    .map((m) => (m.user === botUserId ? "You (Buddy)" : `Member ${m.user ?? "?"}`) + ": " + m.text.trim())
    .join("\n");
  try {
    const raw = await callClaude({
      apiKey,
      model,
      system: ENGAGE_PROMPT,
      userPrompt: `The discussion thread so far:\n\n${transcript}\n\nDecide whether to chime in.`,
      maxTokens: 200,
    });
    const parsed = JSON.parse((raw.match(/\{[\s\S]*\}/) || ["{}"])[0]);
    const emoji = REPLY_EMOJI.includes(parsed.emoji) ? parsed.emoji : "eyes";
    const reply = (parsed.reply ?? "").trim();
    const shouldReply = parsed.shouldReply === true && reply.length > 0;
    return { emoji, shouldReply, reply };
  } catch (err) {
    console.error("generateDiscussionReply failed:", err.message);
    return { emoji: "eyes", shouldReply: false, reply: "" };
  }
}

/** Strip quotes/labels/fences and keep a single clean line. */
function cleanup(raw) {
  let s = (raw || "").trim();
  s = s.replace(/^```[a-z]*\n?/i, "").replace(/```$/i, "").trim();
  s = s.split("\n").map((l) => l.trim()).filter(Boolean)[0] || "";
  s = s.replace(/^[-*\d.\s]+/, "");          // leading bullet/number
  s = s.replace(/^(question|q)\s*[:\-]\s*/i, "");
  s = s.replace(/^["'“”]+|["'“”]+$/g, "");    // wrapping quotes
  return s.trim();
}

function norm(q) {
  return q.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
}

function tokens(q) {
  return new Set(norm(q).split(" ").filter((w) => w.length > 2));
}

/** Token-overlap (Jaccard) similarity — catches near-dupes with swapped tails. */
function similarity(a, b) {
  const A = tokens(a), B = tokens(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter / (A.size + B.size - inter);
}

function isRepeat(q, recent) {
  const n = norm(q);
  return recent.some((r) => {
    const rn = norm(r);
    if (!rn) return false;
    if (rn === n || rn.includes(n) || n.includes(rn)) return true;
    return similarity(q, r) >= 0.5; // same core idea, reworded
  });
}

/** Pick a bank question not used recently; random for variety. */
function pickFromBank(recent = []) {
  const fresh = QUESTION_BANK.filter((q) => !isRepeat(q, recent));
  const pool = fresh.length ? fresh : QUESTION_BANK;
  return pool[Math.floor(Math.random() * pool.length)];
}
