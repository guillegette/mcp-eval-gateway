import type {
  LanguageModelV3GenerateResult,
  LanguageModelV3Prompt,
  LanguageModelV3Usage,
} from '@ai-sdk/provider';
import { MockLanguageModelV3 } from 'ai/test';

const emptyUsage: LanguageModelV3Usage = {
  inputTokens: {
    total: undefined,
    noCache: undefined,
    cacheRead: undefined,
    cacheWrite: undefined,
  },
  outputTokens: {
    total: undefined,
    text: undefined,
    reasoning: undefined,
  },
};

export function textGenerateResult(finalText: string): LanguageModelV3GenerateResult {
  return {
    content: [{ type: 'text', text: finalText }],
    finishReason: { unified: 'stop', raw: 'stop' },
    usage: emptyUsage,
    warnings: [],
  };
}

export function toolCallGenerateResult(
  toolName: string,
  toolInput: object,
): LanguageModelV3GenerateResult {
  return {
    content: [
      {
        type: 'tool-call',
        toolCallId: 'call-1',
        toolName,
        input: JSON.stringify(toolInput),
      },
    ],
    finishReason: { unified: 'tool-calls', raw: 'tool-calls' },
    usage: emptyUsage,
    warnings: [],
  };
}

export function textModel(finalText: string): MockLanguageModelV3 {
  return new MockLanguageModelV3({
    doGenerate: async () => textGenerateResult(finalText),
  });
}

export type ToolThenTextModel = MockLanguageModelV3 & {
  prompts: LanguageModelV3Prompt[];
};

export function toolThenTextModel(
  toolName: string,
  toolInput: object,
  finalText: string,
): ToolThenTextModel {
  const prompts: LanguageModelV3Prompt[] = [];
  let callCount = 0;

  const model = new MockLanguageModelV3({
    doGenerate: async (options) => {
      prompts.push(options.prompt);
      callCount += 1;
      if (callCount === 1) {
        return toolCallGenerateResult(toolName, toolInput);
      }
      return textGenerateResult(finalText);
    },
  });

  return Object.assign(model, { prompts });
}

export function collectStrings(value: unknown, acc: string[] = []): string[] {
  if (typeof value === 'string') {
    acc.push(value);
    return acc;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectStrings(item, acc);
    }
    return acc;
  }
  if (value && typeof value === 'object') {
    for (const item of Object.values(value)) {
      collectStrings(item, acc);
    }
  }
  return acc;
}
