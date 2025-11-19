import type { PgVectorConfig } from '../shared/config';
import { PgVector } from '.';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type QueryCall = { text: string; values?: any[] };

const queryHistory: QueryCall[] = [];

const mockClient = {
  query: vi.fn(),
  release: vi.fn(),
};

class MockPool {
  public options: any;
  public connect = vi.fn(async () => mockClient);
  public end = vi.fn(async () => {});

  constructor(options: any) {
    this.options = options;
  }
}

vi.mock('pg', () => ({
  Pool: MockPool,
}));

describe('PgVector schema-aware vector type handling', () => {
  const config: PgVectorConfig & { id: string } = {
    connectionString: 'postgresql://postgres:postgres@localhost:5432/mastra',
    schemaName: 'custom_schema',
    id: 'pg-vector-schema-test',
  };

  let vectorStore: PgVector;
  let listIndexesSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    queryHistory.length = 0;
    mockClient.query.mockImplementation(async (text: any, values?: any[]) => {
      const sql = typeof text === 'string' ? text : text?.text || '';
      queryHistory.push({ text: sql, values });

      if (sql.includes('information_schema.schemata')) {
        return { rows: [{ exists: true }] };
      }

      if (sql.includes('FROM pg_extension e')) {
        return { rows: [{ schema_name: 'custom_schema' }] };
      }

      return { rows: [] };
    });
    mockClient.release.mockReset();

    listIndexesSpy = vi.spyOn(PgVector.prototype, 'listIndexes').mockResolvedValue([]);

    vectorStore = new PgVector(config);
    await (vectorStore as any).cacheWarmupPromise;
  });

  afterEach(async () => {
    await vectorStore.disconnect();
    listIndexesSpy.mockRestore();
    mockClient.query.mockReset();
  });

  it('prefixes vector type with schema when createIndex runs inside custom schema', async () => {
    await vectorStore.createIndex({
      indexName: 'nlQuery',
      dimension: 1536,
      buildIndex: false,
    });

    const createTableCall = queryHistory.find(call => call.text.includes('CREATE TABLE'));
    expect(createTableCall?.text ?? '').toContain('embedding custom_schema.vector');
  });
});
