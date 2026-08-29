import { describe, expect, it } from 'vitest';
import { resolveModel, runEvals } from '../src/index';

function asProviderModel(model: unknown): { modelId: string; provider: string } {
  if (typeof model !== 'object' || model === null) {
    throw new Error('expected a provider model object');
  }
  const { modelId, provider } = model as { modelId?: unknown; provider?: unknown };
  if (typeof modelId !== 'string' || typeof provider !== 'string') {
    throw new Error('expected modelId and provider strings');
  }
  return { modelId, provider };
}

const unsupportedPrefix = /mistral|anthropic|openai|bedrock|gateway/;

describe('resolveModel', () => {
  it('resolves the anthropic prefix', async () => {
    const model = asProviderModel(await resolveModel('anthropic/claude-sonnet-4-6'));
    expect(model.modelId).toBe('claude-sonnet-4-6');
    expect(model.provider).toContain('anthropic');
  });

  it('resolves the openai prefix', async () => {
    const model = asProviderModel(await resolveModel('openai/gpt-5.2'));
    expect(model.modelId).toBe('gpt-5.2');
    expect(model.provider).toContain('openai');
  });

  it('resolves the bedrock prefix', async () => {
    const model = asProviderModel(
      await resolveModel('bedrock/anthropic.claude-sonnet-4-5-20250929-v1:0'),
    );
    expect(model.modelId).toBe('anthropic.claude-sonnet-4-5-20250929-v1:0');
    expect(model.provider).toContain('bedrock');
  });

  it('passes the gateway remainder through as a string', async () => {
    await expect(resolveModel('gateway/anthropic/claude-sonnet-4-6')).resolves.toBe(
      'anthropic/claude-sonnet-4-6',
    );
  });

  it('rejects an unknown prefix', async () => {
    await expect(resolveModel('mistral/small')).rejects.toThrow(Error);
    await expect(resolveModel('mistral/small')).rejects.toThrow(unsupportedPrefix);
    const error = await resolveModel('mistral/small').catch((err: unknown) => err);
    expect(error).toBeInstanceOf(Error);
    const message = (error as Error).message;
    expect(message).toContain('mistral');
    expect(message).toContain('anthropic');
    expect(message).toContain('openai');
    expect(message).toContain('bedrock');
    expect(message).toContain('gateway');
  });

  it('rejects a string with no slash', async () => {
    const error = await resolveModel('claude-sonnet-4-6').catch((err: unknown) => err);
    expect(error).toBeInstanceOf(Error);
    const message = (error as Error).message;
    expect(message).toContain('anthropic');
    expect(message).toContain('openai');
    expect(message).toContain('bedrock');
    expect(message).toContain('gateway');
  });

  it('runEvals resolves string models before calling the model', async () => {
    const error = await runEvals({
      model: 'mistral/small',
      tools: {},
      tasks: [{ name: 'trivial', prompt: 'hi', expected: 'hi' }],
    }).catch((err: unknown) => err);

    expect(error).toBeInstanceOf(Error);
    const message = (error as Error).message;
    expect(message).toContain('mistral');
    expect(message).toContain('anthropic');
    expect(message).toContain('openai');
    expect(message).toContain('bedrock');
    expect(message).toContain('gateway');
  });
});
