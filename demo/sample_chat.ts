/**
 * Sample Chat Application — Tracelet Demo
 *
 * This file demonstrates a simple OpenAI chat completion in TypeScript.
 * Tracelet's CodeLens detects the `openai.chat.completions.create` call
 * and maps runtime traces back to this exact line number.
 */

import OpenAI from "openai";

const openai = new OpenAI();

async function chatCompletion(userMessage: string): Promise<string> {
  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0.5,
    max_tokens: 512,
    messages: [
      {
        role: "system",
        content: "You are a concise coding assistant. Answer briefly.",
      },
      {
        role: "user",
        content: userMessage,
      },
    ],
  });

  return response.choices[0].message.content ?? "";
}

// ─── Example usage ──────────────────────────────────────────────────────────

async function main() {
  const answer = await chatCompletion("What is a Python decorator?");
  console.log(answer);
}

main().catch(console.error);
