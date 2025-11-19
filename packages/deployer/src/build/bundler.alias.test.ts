import { describe, it, expect } from 'vitest';
import type { Plugin } from 'rollup';

import { getInputOptions } from './bundler';

const analyzedInfo = {
  dependencies: new Map<string, string>([['zod', '.mastra/.build/zod.mjs']]),
  externalDependencies: new Set<string>(),
  workspaceMap: new Map(),
};

describe('alias-optimized-deps plugin', () => {
  it('does not rewrite a dependency when importer is the generated module itself', async () => {
    const inputOptions = await getInputOptions('entry.ts', analyzedInfo as any, 'node', undefined, {
      projectRoot: '/project',
    });

    const plugin = (inputOptions.plugins as Plugin[]).find(p => p && p.name === 'alias-optimized-deps');
    expect(plugin).toBeDefined();

    const rewriteResult = await plugin!.resolveId!('zod', '/project/src/mastra/index.ts', {} as any);
    expect(rewriteResult).toEqual({ id: '/project/.mastra/.build/zod.mjs', external: false });

    const selfReference = await plugin!.resolveId!('zod', '/project/.mastra/.build/zod.mjs', {} as any);
    expect(selfReference).toBeNull();
  });
});
