# V11 Hype Bot 🚀🔥

A Slack **hype man** for the V11 founder-builder community. It watches every new
message in your channel and responds with:

- an upbeat **emoji reaction** on the message, and
- a short, genuine, **AI-generated hype reply** posted in a thread (so the
  channel stays clean).

Replies are written by **Claude** (`claude-haiku-4-5` by default) and are
specific to each message — celebrating wins, hyping ideas, and encouraging the
hard days. Never sarcastic, never generic.

## Architecture

```
Slack message ──▶ Lambda Function URL ──(verify + ack <3s)──▶ async self-invoke
                                                                   │
                                                                   ▼
                                                  Claude (hype text + emoji)
                                                                   │
                                          ┌────────────────────────┴───────────┐
                                          ▼                                     ▼
                                  reactions.add                         chat.postMessage
                                  (emoji on message)                    (reply in thread)
```

One **AWS Lambda** function behind a **Function URL** receives Slack's Events
API webhooks. Slack requires a response within 3 seconds, so the function
verifies the request signature, **acks immediately**, and asynchronously
re-invokes itself to do the slower work (the Claude call + Slack API calls).

- **Cost:** effectively free at community scale — a few Lambda invocations per
  message, plus a small Claude (Haiku) call each time.
- **No servers to manage.** Fully serverless.

## What you need

1. An **AWS account** + the [AWS SAM CLI](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html)
   and AWS credentials configured (`aws configure`).
2. A **Slack app** in your workspace (you said you've already configured one).
3. An **Anthropic API key** from <https://console.anthropic.com>.

## Slack app setup

If you built the app from scratch, make sure it has:

**Bot Token Scopes** (OAuth & Permissions):
`chat:write`, `reactions:write`, `channels:history`, `groups:history`,
`users:read` (optional).

**Event Subscriptions → Subscribe to bot events:**
`message.channels` (public) and/or `message.groups` (private).

You'll set the **Request URL** after deploying (next section). The
[`slack-app-manifest.yaml`](./slack-app-manifest.yaml) in this repo can recreate
the app from scratch if you prefer.

Finally: **invite the bot to your V11 channel** (`/invite @hype-bot`).

## Deploy

```bash
npm install
sam build

# First time — guided (it'll save your answers to samconfig.toml):
sam deploy --guided \
  --parameter-overrides \
    SlackBotToken=xoxb-... \
    SlackSigningSecret=... \
    AnthropicApiKey=sk-ant-...
# The bot is locked to the V11 channel (C08LKRUL3AB) by default — see template.yaml.
# To hype every channel it's invited to instead, add: TargetChannelId=""
```

When it finishes, SAM prints a **`FunctionUrl`** output, e.g.
`https://abcd1234.lambda-url.us-east-1.on.aws`.

1. Copy that URL into your Slack app → **Event Subscriptions → Request URL**
   (no trailing slash). Slack will send a verification handshake — the bot
   answers it automatically, so you should see **Verified ✅**.
2. Reinstall the app to your workspace if Slack prompts you.
3. Invite the bot to your channel and post a message. Watch it get hyped. 🎉

Re-deploy after code changes with just `sam build && sam deploy`.

## Configuration

| Env var (SAM parameter) | Default | Purpose |
|---|---|---|
| `SlackBotToken` | — | Bot token (`xoxb-...`) |
| `SlackSigningSecret` | — | Verifies requests really come from Slack |
| `AnthropicApiKey` | — | Auth for Claude |
| `AnthropicModel` | `claude-haiku-4-5` | Swap to `claude-sonnet-4-6` for richer replies |
| `TargetChannelId` | _(empty)_ | If set, the bot only reacts in that one channel |

To find a channel ID: open the channel in Slack → **View channel details** →
it's at the bottom (starts with `C`).

## Test the vibe locally (no AWS/Slack needed)

```bash
npm install
ANTHROPIC_API_KEY=sk-ant-... node test/local.mjs "I just shipped my MVP!"
```

This calls Claude directly and prints the reaction + reply it would have posted.

## How it stays well-behaved

- **No infinite loops:** ignores messages from bots (including itself) and all
  message subtypes (edits, joins, deletes).
- **Top-level only:** hypes new channel messages, not every thread reply.
- **No double-posts:** Slack retries are detected and ignored.
- **Verified requests only:** every webhook is signature-checked before any work.
- **Graceful fallback:** if Claude is unavailable, it posts a canned hype line.

## Tuning the personality

The hype man's voice lives in `SYSTEM_PROMPT` in
[`src/hype.mjs`](./src/hype.mjs), and the allowed reaction emoji are in the
`ALLOWED_EMOJI` list there. Edit, `sam deploy`, done.

---

MIT licensed. Go build, V11. 💪
