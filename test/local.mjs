// Quick local sanity check for the hype generator.
// Usage:  ANTHROPIC_API_KEY=sk-ant-... node test/local.mjs "I just shipped my MVP!"
//
// Exercises only the Claude call (no AWS, no Slack) so you can confirm the
// vibe before deploying.

import { generateHype } from "../src/hype.mjs";

const apiKey = process.env.ANTHROPIC_API_KEY;
const model = process.env.ANTHROPIC_MODEL || "claude-haiku-4-5";

if (!apiKey) {
  console.error("Set ANTHROPIC_API_KEY first.");
  process.exit(1);
}

const samples = process.argv.slice(2).length
  ? process.argv.slice(2)
  : [
      "I just shipped my MVP after 3 months of nights and weekends 🎉",
      "Closed our first paying customer today!!",
      "honestly kind of burnt out, the demo broke during my pitch and I'm second-guessing everything",
      "Quick win: rewrote our onboarding and signups are up 40%",
    ];

for (const text of samples) {
  const out = await generateHype({ apiKey, model, text });
  console.log("\nMESSAGE: ", text);
  console.log("REACTION::" + out.emoji + ":");
  console.log("REPLY:   ", out.reply);
}
