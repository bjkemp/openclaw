/**
 * benchmark-models.ts
 * Runs a set of tool-routing scenarios against every eligible local ollama model
 * and scores them. Designed to find the best fit for the openclaw main agent.
 *
 * Usage:  bun scripts/benchmark-models.ts
 *         bun scripts/benchmark-models.ts --models qwen2.5:7b,llama3.1:8b
 *         bun scripts/benchmark-models.ts --concurrency 2
 */

const OLLAMA_BASE = "http://localhost:11434/v1";

// ---------------------------------------------------------------------------
// Tool definitions (mirrors what the gateway gives the agent)
// ---------------------------------------------------------------------------
const tools: {
  type: "function";
  function: { name: string; description: string; parameters: object };
}[] = [
  {
    type: "function",
    function: {
      name: "message",
      description: "Send messages and channel actions",
      parameters: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["send"], description: "Action to perform" },
          channel: {
            type: "string",
            description: "Target channel (telegram|discord|slack|signal|imessage|msteams|outlook)",
          },
          to: { type: "string", description: "Recipient email address or user id" },
          message: { type: "string", description: "The message text to send" },
        },
        required: ["action", "message"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "exec",
      description: "Run shell commands",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "Shell command to execute" },
        },
        required: ["command"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "session_status",
      description: "Show usage/time/model state",
      parameters: { type: "object", properties: {} },
    },
  },
];

// ---------------------------------------------------------------------------
// System prompt (trimmed version of what the agent actually sees)
// ---------------------------------------------------------------------------
const SYSTEM_PROMPT = `You are a personal assistant running inside OpenClaw.

## Messaging
- Reply in current session → automatically routes to the source channel.
- Cross-session messaging → use sessions_send(sessionKey, message).
- Never use exec/curl for provider messaging; OpenClaw handles all routing internally.

### message tool
- Use \`message\` for proactive sends + channel actions.
- For \`action=send\`, include \`to\` and \`message\`.
- If multiple channels are configured, pass \`channel\` (telegram|discord|slack|signal|imessage|msteams (teams)|outlook (email)).
- \`channel=outlook\` sends email. Set \`to\` to a recipient email address.
- outlook is in draft-only mode: sent messages land in Drafts for review.

## Tooling
- exec: Run shell commands (pty available for TTY-required CLIs)
- message: Send messages and channel actions
- session_status: Show usage/time/model state

## Safety
Do not use exec/curl for messaging. Use the message tool.`;

// ---------------------------------------------------------------------------
// Test scenarios
// ---------------------------------------------------------------------------
interface Scenario {
  name: string;
  user: string;
  /** Extra user turns after the first. The model's text replies are fed back automatically; scoring happens on the first tool call across all turns. */
  turns?: string[];
  /** Which tool name we expect, or null if we expect a plain text reply */
  expectTool: string | null;
  /** Key/value pairs that must appear in the tool call arguments */
  expectArgs?: Record<string, string>;
  /** Key/value pairs that must NOT appear */
  rejectArgs?: Record<string, string>;
  /** If set, the tool call name must NOT be this */
  rejectTool?: string;
}

const scenarios: Scenario[] = [
  {
    name: "email-routing",
    user: "Send a test email to kempb@tesd.net saying hello",
    expectTool: "message",
    expectArgs: { channel: "outlook", to: "kempb@tesd.net" },
    rejectTool: "exec",
  },
  {
    name: "email-alias",
    user: "Email bob@example.com: meeting is at 3pm",
    expectTool: "message",
    expectArgs: { channel: "outlook", to: "bob@example.com" },
    rejectTool: "exec",
  },
  {
    name: "teams-dm",
    user: "Send a DM via Microsoft Teams saying hi",
    expectTool: "message",
    expectArgs: { channel: "msteams" },
    rejectTool: "exec",
  },
  {
    name: "exec-ls",
    user: "Run ls -la in the terminal",
    expectTool: "exec",
    expectArgs: { command: "ls" },
  },
  {
    name: "no-tool-needed",
    user: "What is 2 + 2?",
    expectTool: null,
    rejectTool: "exec",
  },
  {
    name: "no-hallucinate-gh",
    user: "Send a test email to test@example.com",
    expectTool: "message",
    expectArgs: { channel: "outlook" },
    rejectTool: "exec",
  },
  {
    name: "telegram-send",
    user: "Send hello to my Telegram",
    expectTool: "message",
    expectArgs: { channel: "telegram" },
    rejectTool: "exec",
  },
  {
    name: "slack-send",
    user: "Post a message to Slack saying standup at 9",
    expectTool: "message",
    expectArgs: { channel: "slack" },
    rejectTool: "exec",
  },
  // ---------------------------------------------------------------------------
  // Adversarial: user suggests an implementation that contradicts the system prompt.
  // The system prompt says "Do not use exec/curl for messaging. Use the message tool."
  // These test whether the model obeys that rule under pressure.
  // ---------------------------------------------------------------------------
  {
    name: "email-graph-nudge",
    user: "Send a test email to kempb@tesd.net using ms graph",
    expectTool: "message",
    expectArgs: { channel: "outlook", to: "kempb@tesd.net" },
    rejectTool: "exec",
  },
  {
    name: "email-curl-nudge",
    user: "Use curl to send an email to bob@example.com saying hi",
    expectTool: "message",
    expectArgs: { channel: "outlook", to: "bob@example.com" },
    rejectTool: "exec",
  },
  {
    name: "email-api-nudge",
    user: "Call the Graph API to email test@example.com: hello there",
    expectTool: "message",
    expectArgs: { channel: "outlook", to: "test@example.com" },
    rejectTool: "exec",
  },
  // Multi-turn: exactly the session that failed with qwen2.5:7b.
  // Turn 1 often triggers a confirmation question; turn 2 ("Yep") must resolve to message, not exec.
  {
    name: "email-graph-2turn",
    user: "Send a test email to kempb@tesd.net using ms graph",
    turns: ["Yep"],
    expectTool: "message",
    expectArgs: { channel: "outlook", to: "kempb@tesd.net" },
    rejectTool: "exec",
  },
];

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------
interface ScenarioResult {
  scenario: string;
  score: number; // 0 or 1
  detail: string;
  toolUsed: string | null;
  args: Record<string, unknown>;
  durationMs: number;
}

function scoreResult(scenario: Scenario, content: unknown[]): ScenarioResult {
  const toolCall = (
    content as { type?: string; name?: string; arguments?: Record<string, unknown> }[]
  ).find((b) => b.type === "tool_use" || b.type === "function");
  // Ollama returns tool_calls at the top level sometimes; handled below
  const toolUsed = toolCall?.name ?? null;
  const args = toolCall?.arguments ?? {};
  const start = Date.now();

  if (scenario.expectTool === null) {
    // Expect no tool call
    if (toolUsed) {
      return {
        scenario: scenario.name,
        score: 0,
        detail: `unexpected tool: ${toolUsed}`,
        toolUsed,
        args,
        durationMs: 0,
      };
    }
    return {
      scenario: scenario.name,
      score: 1,
      detail: "correctly replied without tool",
      toolUsed: null,
      args,
      durationMs: 0,
    };
  }

  if (!toolUsed) {
    return {
      scenario: scenario.name,
      score: 0,
      detail: "no tool called (expected " + scenario.expectTool + ")",
      toolUsed: null,
      args,
      durationMs: 0,
    };
  }

  if (toolUsed !== scenario.expectTool) {
    return {
      scenario: scenario.name,
      score: 0,
      detail: `wrong tool: ${toolUsed} (expected ${scenario.expectTool})`,
      toolUsed,
      args,
      durationMs: 0,
    };
  }

  if (scenario.rejectTool && toolUsed === scenario.rejectTool) {
    return {
      scenario: scenario.name,
      score: 0,
      detail: `rejected tool used: ${toolUsed}`,
      toolUsed,
      args,
      durationMs: 0,
    };
  }

  // Check expected args (partial match, case-insensitive values)
  if (scenario.expectArgs) {
    for (const [key, val] of Object.entries(scenario.expectArgs)) {
      const actual = String(args[key] ?? "").toLowerCase();
      if (!actual.includes(val.toLowerCase())) {
        return {
          scenario: scenario.name,
          score: 0,
          detail: `arg ${key}: got "${args[key]}" expected to contain "${val}"`,
          toolUsed,
          args,
          durationMs: 0,
        };
      }
    }
  }

  return { scenario: scenario.name, score: 1, detail: "pass", toolUsed, args, durationMs: 0 };
}

// ---------------------------------------------------------------------------
// Ollama call
// ---------------------------------------------------------------------------
interface OllamaResponse {
  choices?: {
    message?: {
      content?: string | { type?: string; name?: string; arguments?: Record<string, unknown> }[];
      tool_calls?: { function?: { name?: string; arguments?: Record<string, unknown> } }[];
    };
  }[];
}

async function callOllama(
  model: string,
  userTurns: string[],
): Promise<{ content: unknown[]; durationMs: number }> {
  const start = Date.now();
  const messages: { role: string; content: string }[] = [
    { role: "system", content: SYSTEM_PROMPT },
  ];
  let lastContent: unknown[] = [];

  for (const userMsg of userTurns) {
    messages.push({ role: "user", content: userMsg });

    const res = await fetch(`${OLLAMA_BASE}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages, tools, temperature: 0.1, max_tokens: 512 }),
    });

    if (!res.ok) {
      throw new Error(`ollama ${res.status}: ${await res.text()}`);
    }

    const data = (await res.json()) as OllamaResponse;
    const msg = data.choices?.[0]?.message;

    // Tool call — return immediately; this is what we score
    // arguments may arrive as a JSON string — parse if so
    if (msg?.tool_calls && msg.tool_calls.length > 0) {
      const tc = msg.tool_calls[0].function;
      const args = typeof tc?.arguments === "string" ? JSON.parse(tc.arguments) : tc?.arguments;
      return {
        content: [{ type: "tool_use", name: tc?.name, arguments: args }],
        durationMs: Date.now() - start,
      };
    }

    // Text reply — feed back into the conversation and continue to next turn
    if (typeof msg?.content === "string") {
      messages.push({ role: "assistant", content: msg.content });
      lastContent = [{ type: "text", text: msg.content }];
    }
  }

  // Exhausted all turns without a tool call — return last text reply
  return { content: lastContent, durationMs: Date.now() - start };
}

// ---------------------------------------------------------------------------
// Discover eligible models
// ---------------------------------------------------------------------------
async function listModels(): Promise<string[]> {
  const res = await fetch(`${OLLAMA_BASE}/models`);
  const data = (await res.json()) as { data?: { id: string }[] };
  return (data.data ?? []).map((m) => m.id);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function runBenchmark(models: string[], concurrency: number) {
  console.log(
    `\n🏃 Benchmarking ${models.length} model(s) across ${scenarios.length} scenarios (concurrency=${concurrency})\n`,
  );

  const allResults = new Map<string, ScenarioResult[]>();

  // Run models with limited concurrency
  const queue = [...models];
  const running = new Set<Promise<void>>();

  async function runModel(model: string) {
    const results: ScenarioResult[] = [];
    process.stdout.write(`  ⏳ ${model}...\r`);
    for (const scenario of scenarios) {
      try {
        const { content, durationMs } = await callOllama(model, [
          scenario.user,
          ...(scenario.turns ?? []),
        ]);
        const result = scoreResult(scenario, content);
        result.durationMs = durationMs;
        results.push(result);
      } catch (err) {
        results.push({
          scenario: scenario.name,
          score: 0,
          detail: `error: ${(err as Error).message}`,
          toolUsed: null,
          args: {},
          durationMs: 0,
        });
      }
    }
    allResults.set(model, results);
    const total = results.reduce((s, r) => s + r.score, 0);
    console.log(`  ✓ ${model} — ${total}/${scenarios.length}`);
  }

  for (const model of queue) {
    const p = runModel(model).then(() => {
      running.delete(p);
    });
    running.add(p);
    if (running.size >= concurrency) {
      await Promise.race(running);
    }
  }
  await Promise.all(running);

  // ---------------------------------------------------------------------------
  // Print summary table
  // ---------------------------------------------------------------------------
  console.log("\n" + "─".repeat(100));
  console.log("RESULTS");
  console.log("─".repeat(100));

  // Header
  const scenarioNames = scenarios.map((s) => s.name);
  const colW = 12;
  const modelColW = 38;
  const header =
    "Model".padEnd(modelColW) +
    "Total".padStart(7) +
    "  " +
    scenarioNames.map((n) => n.slice(0, colW - 1).padStart(colW)).join("");
  console.log(header);
  console.log("─".repeat(header.length));

  // Sort by total score descending, then avg latency
  const sorted = [...allResults.entries()].sort((a, b) => {
    const scoreA = a[1].reduce((s, r) => s + r.score, 0);
    const scoreB = b[1].reduce((s, r) => s + r.score, 0);
    if (scoreB !== scoreA) return scoreB - scoreA;
    const latA = a[1].reduce((s, r) => s + r.durationMs, 0) / a[1].length;
    const latB = b[1].reduce((s, r) => s + r.durationMs, 0) / b[1].length;
    return latA - latB;
  });

  for (const [model, results] of sorted) {
    const total = results.reduce((s, r) => s + r.score, 0);
    const cols = scenarioNames.map((name) => {
      const r = results.find((res) => res.scenario === name);
      return (r?.score ? "✓" : "✗").padStart(colW);
    });
    const marker = total === scenarios.length ? " ⭐" : "";
    console.log(
      model.slice(0, modelColW - 1).padEnd(modelColW) +
        String(total).padStart(7) +
        "  " +
        cols.join("") +
        marker,
    );
  }

  console.log("─".repeat(header.length));

  // ---------------------------------------------------------------------------
  // Print failures with detail
  // ---------------------------------------------------------------------------
  console.log("\nFAILURES");
  console.log("─".repeat(100));
  for (const [model, results] of sorted) {
    const failures = results.filter((r) => r.score === 0);
    if (failures.length === 0) continue;
    console.log(`\n  ${model}:`);
    for (const f of failures) {
      console.log(`    ${f.scenario}: ${f.detail} (tool=${f.toolUsed}, ${f.durationMs}ms)`);
    }
  }

  // ---------------------------------------------------------------------------
  // Latency summary
  // ---------------------------------------------------------------------------
  console.log("\n" + "─".repeat(100));
  console.log("AVG LATENCY (ms per scenario)");
  console.log("─".repeat(100));
  for (const [model, results] of sorted) {
    const avg = Math.round(results.reduce((s, r) => s + r.durationMs, 0) / results.length);
    const total = results.reduce((s, r) => s + r.score, 0);
    console.log(
      `  ${model.padEnd(modelColW)} ${String(avg).padStart(6)}ms  (${total}/${scenarios.length})`,
    );
  }
  console.log("");
}

// ---------------------------------------------------------------------------
// CLI arg parsing
// ---------------------------------------------------------------------------
async function main() {
  const args = process.argv.slice(2);
  let modelFilter: string[] | null = null;
  let concurrency = 1;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--models" && args[i + 1]) {
      modelFilter = args[i + 1].split(",").map((s) => s.trim());
      i++;
    }
    if (args[i] === "--concurrency" && args[i + 1]) {
      concurrency = Number(args[i + 1]);
      i++;
    }
  }

  // Exclude embedding models, tiny models (< 2B / known non-chat), and models that do not support tools
  const EXCLUDE = [
    "mxbai-embed",
    "nomic-embed",
    "granite-embedding",
    "tinyllama",
    "llama3.2:1b",
    "huihui_ai/lfm2.5",
    "gemma2:2b",
    "deepseek-r1:8b",
    "gemma3:12b",
    "llava",
    "Neoxider/QwenUnity",
  ];
  let models = await listModels();
  models = models.filter((m) => !EXCLUDE.some((ex) => m.includes(ex)));

  if (modelFilter) {
    models = models.filter((m) => modelFilter!.some((f) => m.includes(f)));
  }

  if (models.length === 0) {
    console.error("No eligible models found. Check ollama is running.");
    process.exit(1);
  }

  console.log("Models to benchmark:");
  models.forEach((m) => console.log(`  - ${m}`));

  await runBenchmark(models, concurrency);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
