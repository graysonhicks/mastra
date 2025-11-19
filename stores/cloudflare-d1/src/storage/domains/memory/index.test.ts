import { describe, it, expect } from 'vitest';

import { MemoryStorageD1 } from './index';
import { StoreOperationsD1 } from '../operations';
import type { SqlQueryOptions } from '../../sql-builder';

type MockMessageRow = {
  id: string;
  content: string;
  role: string;
  type: string;
  createdAt: string;
  threadId: string;
  resourceId: string;
};

class TestOperations extends StoreOperationsD1 {
  constructor(private readonly rows: MockMessageRow[]) {
    super({ client: { query: async () => ({ result: [] }) } });
  }

  async executeQuery({ sql, params = [] }: SqlQueryOptions) {
    if (sql.includes('count()')) {
      const [threadId] = params;
      const total = this.rows.filter(row => row.threadId === threadId).length;
      return [{ count: total }];
    }

    if (sql.includes('SELECT id, content')) {
      const [threadId] = params;
      const direction = sql.includes('DESC') ? 'DESC' : 'ASC';
      const limitIndex = params.length - 2;
      const offsetIndex = params.length - 1;
      const limit = Number(params[limitIndex] ?? this.rows.length);
      const offset = Number(params[offsetIndex] ?? 0);

      const filtered = this.rows.filter(row => row.threadId === threadId);
      const sorted = filtered.sort((a, b) =>
        direction === 'ASC'
          ? a.createdAt.localeCompare(b.createdAt)
          : b.createdAt.localeCompare(a.createdAt),
      );

      return sorted.slice(offset, offset + limit);
    }

    return [];
  }
}

const baseTimestamp = Date.UTC(2024, 0, 1, 0, 0, 0);
const createMessages = (count: number): MockMessageRow[] =>
  Array.from({ length: count }, (_, idx) => ({
    id: `msg-${String(idx + 1).padStart(2, '0')}`,
    content: JSON.stringify({
      content: [{ type: 'text', text: `Message ${idx + 1}` }],
    }),
    role: idx % 2 === 0 ? 'user' : 'assistant',
    type: 'v2',
    createdAt: new Date(baseTimestamp + idx * 1000).toISOString(),
    threadId: 'thread-1',
    resourceId: 'resource-1',
  }));

describe('MemoryStorageD1.listMessages', () => {
  it('returns the newest messages when paginated (regression test for issue #9991)', async () => {
    const operations = new TestOperations(createMessages(10));
    const memory = new MemoryStorageD1({ operations });

    const result = await memory.listMessages({
      threadId: 'thread-1',
      perPage: 5,
      page: 0,
    });

    expect(result.messages.map(message => message.id)).toEqual([
      'msg-10',
      'msg-09',
      'msg-08',
      'msg-07',
      'msg-06',
    ]);
  });
});
