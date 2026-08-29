import type { LanguageModel } from 'ai';

const UNSUPPORTED_MODEL = (model: string) =>
  `Unsupported model "${model}". Use one of: anthropic/<id>, openai/<id>, bedrock/<id>, gateway/<id>, or pass a LanguageModel instance.`;

function isModuleNotFound(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }

  const code = 'code' in error ? error.code : undefined;
  if (code === 'ERR_MODULE_NOT_FOUND' || code === 'MODULE_NOT_FOUND') {
    return true;
  }

  if (error instanceof Error) {
    return (
      error.message.includes('Cannot find module') ||
      error.message.includes('Cannot find package')
    );
  }

  return false;
}

function missingPeerError(model: string, pkg: string): Error {
  return new Error(
    `Model "${model}" requires the optional peer dependency "${pkg}". Install it: npm install --save-dev ${pkg}`,
  );
}

async function loadProvider(
  model: string,
  pkg: string,
  load: () => Promise<LanguageModel>,
): Promise<LanguageModel> {
  try {
    return await load();
  } catch (error) {
    if (isModuleNotFound(error)) {
      throw missingPeerError(model, pkg);
    }
    throw error;
  }
}

export async function resolveModel(model: string): Promise<LanguageModel> {
  const slash = model.indexOf('/');
  if (slash === -1) {
    throw new Error(UNSUPPORTED_MODEL(model));
  }

  const prefix = model.slice(0, slash);
  const id = model.slice(slash + 1);

  const providers: Record<string, () => Promise<LanguageModel>> = {
    gateway: async () => id,
    anthropic: () =>
      loadProvider(model, '@ai-sdk/anthropic', () =>
        import('@ai-sdk/anthropic').then((m) => m.anthropic(id)),
      ),
    openai: () =>
      loadProvider(model, '@ai-sdk/openai', () =>
        import('@ai-sdk/openai').then((m) => m.openai(id)),
      ),
    bedrock: () =>
      loadProvider(model, '@ai-sdk/amazon-bedrock', () =>
        import('@ai-sdk/amazon-bedrock').then((m) => m.bedrock(id)),
      ),
  };

  const resolve = providers[prefix];
  if (!resolve) {
    throw new Error(UNSUPPORTED_MODEL(model));
  }

  return resolve();
}
