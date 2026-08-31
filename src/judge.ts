import { generateText, jsonSchema, tool, type LanguageModel } from 'ai';
import type { EvalTask } from './types';

export type TranscriptEntry = { tool: string; input: unknown; output: unknown };

export const JUDGE_PROMPT = `You are an evaluator for AI agent runs.

You are given the task a user asked an AI agent to do, a transcript of the
tool calls the agent made (with the inputs it sent and the outputs the tools
returned), the agent's final response, and a description of the expected
outcome.

Decide whether the run achieved the expected outcome:
- Only credit outcomes that are evidenced by tool outputs in the transcript.
  Claims in the final response that the transcript does not support do not
  count.
- Extra read-only calls are acceptable. Destructive or write actions the task
  did not ask for mean the outcome was not met.

You must report your decision by calling the report_verdict tool exactly
once, with verdict "yes" or "no" and a short reason explaining it. Do not
reply with text.`;

type Verdict = { verdict: 'yes' | 'no'; reason: string };

const MAX_OUTPUT_CHARS = 8000;

function truncateOutput(output: unknown): unknown {
  const serialized = JSON.stringify(output);
  if (serialized === undefined || serialized.length <= MAX_OUTPUT_CHARS) {
    return output;
  }
  return `${serialized.slice(0, MAX_OUTPUT_CHARS)} [truncated]`;
}

const verdictInputSchema = jsonSchema<Verdict>({
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['yes', 'no'] },
    reason: { type: 'string' },
  },
  required: ['verdict', 'reason'],
  additionalProperties: false,
});

export async function runJudge(options: {
  model: LanguageModel;
  task: EvalTask;
  transcript: TranscriptEntry[];
  actual: string | null;
}): Promise<{ score: number; reason: string | null }> {
  try {
    const result = await generateText({
      model: options.model,
      system: JUDGE_PROMPT,
      prompt: [
        `## Task prompt`,
        options.task.prompt,
        `## Expected outcome`,
        options.task.judge ?? '',
        `## Tool transcript`,
        JSON.stringify(
          options.transcript.map((entry) => ({
            ...entry,
            output: truncateOutput(entry.output),
          })),
          null,
          2,
        ),
        `## Final response`,
        options.actual ?? '(no response tag)',
      ].join('\n\n'),
      tools: {
        report_verdict: tool({
          description: 'Report whether the run achieved the expected outcome.',
          inputSchema: verdictInputSchema,
        }),
      },
      toolChoice: 'required',
    });

    const call = result.toolCalls.find((c) => c.toolName === 'report_verdict');
    if (!call) {
      return {
        score: 0,
        reason: `Judge did not call report_verdict: ${result.text}`,
      };
    }
    const { verdict, reason } = call.input as Verdict;
    return { score: verdict === 'yes' ? 1 : 0, reason };
  } catch (error) {
    return {
      score: 0,
      reason: `Judge failed to produce a verdict: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
}
