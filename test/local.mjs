// Quick local sanity check for the generators (no AWS, no Slack).
// Usage:
//   Hype:   ANTHROPIC_API_KEY=sk-ant-... node test/local.mjs "I just shipped my MVP!"
//   Reply:  ANTHROPIC_API_KEY=sk-ant-... node test/local.mjs --reply "what's a good name for my app?"

import { generateHype, generateReply } from "../src/hype.mjs";

const apiKey = process.env.ANTHROPIC_API_KEY;
const model = process.env.ANTHROPIC_MODEL || "claude-haiku-4-5";

if (!apiKey) {
  console.error("Set ANTHROPIC_API_KEY first.");
  process.exit(1);
}

// --reply mode: exercise the interactive answer path (with a small fake thread).
if (process.argv[2] === "--reply") {
  const question = process.argv.slice(3).join(" ") || "what should I focus on this week?";
  const thread = [
    { user: "U_USER", text: "starting a tool that summarizes Slack threads" },
    { user: "U_BUDDY", text: "Love it — that's a real pain point! 🔥" },
  ];
  const out = await generateReply({
    apiKey,
    model,
    text: question,
    thread,
    botUserId: "U_BUDDY",
  });
  console.log("\nQUESTION:  ", question);
  console.log("REACTION:  :" + out.emoji + ":");
  console.log("REPLY:     ", out.reply);
  process.exit(0);
}

const samples = process.argv.slice(2).length
  ? process.argv.slice(2)
  : [
      "I just shipped my MVP after 3 months of nights and weekends 🎉",
      "Closed our first paying customer today!!",
      "honestly kind of burnt out, the demo broke during my pitch and I'm second-guessing everything",
      "Quick win: rewrote our onboarding and signups are up 40%",
      "hey does anyone have the link to the deck from last week?",
      "thanks!",
    ];

for (const text of samples) {
  const out = await generateHype({ apiKey, model, text });
  console.log("\nMESSAGE:  ", text);
  console.log("REACTION:  :" + out.emoji + ":");
  console.log("REPLY?:    ", out.shouldReply ? "yes" : "no (react only)");
  if (out.shouldReply) console.log("REPLY:     ", out.reply);
}
