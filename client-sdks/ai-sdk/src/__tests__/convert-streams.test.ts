import type { MastraModelOutput } from '@mastra/core/stream';
import { describe, expect, it } from 'vitest';
import { toAISdkV5Stream } from '../convert-streams';

describe('toAISdkFormat', () => {
  describe('messageMetadata support', () => {
    it('should attach messageMetadata to the converted stream', async () => {
      const mockStream = new ReadableStream({
        start(controller) {
          controller.enqueue({
            type: 'start',
            runId: 'run-1',
            payload: { id: 'response' },
          });
          controller.enqueue({
            type: 'text-delta',
            runId: 'run-1',
            payload: {
              id: 'text-1',
              text: 'Hello world',
            },
          });
          controller.enqueue({
            type: 'finish',
            runId: 'run-1',
            payload: {
              stepResult: { reason: 'stop' },
              output: { usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } },
            },
          });
          controller.close();
        },
      });

      const aiSdkStream = toAISdkV5Stream(mockStream as unknown as MastraModelOutput, {
        from: 'agent',
        messageMetadata: () => ({
          spanId: 'test-trace-123',
        }),
      });

      const parts: any[] = [];
      for await (const part of aiSdkStream) {
        parts.push(part);
      }

      const startChunk = parts.find(chunk => chunk.type === 'start');
      const metadataChunk = parts.find(chunk => chunk.type === 'message-metadata');

      expect(startChunk?.messageMetadata).toEqual({ spanId: 'test-trace-123' });
      expect(metadataChunk?.messageMetadata).toEqual({ spanId: 'test-trace-123' });
    });
  });
});
