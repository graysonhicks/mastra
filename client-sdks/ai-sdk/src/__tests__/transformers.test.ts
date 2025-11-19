import type { ChunkType } from '@mastra/core/stream';
import { ChunkFrom } from '@mastra/core/stream';
import { describe, expect, it } from 'vitest';
import { WorkflowStreamToAISDKTransformer } from '../transformers';

async function collectStream<T>(stream: ReadableStream<T>): Promise<T[]> {
  const items: T[] = [];
  for await (const chunk of stream as any) {
    items.push(chunk);
  }
  return items;
}

describe('WorkflowStreamToAISDKTransformer', () => {
  it('forwards workflow-step-output chunks downstream', async () => {
    const workflowChunk = {
      type: 'workflow-step-output',
      runId: 'run-123',
      from: ChunkFrom.USER,
      payload: {
        output: {
          type: 'custom-event',
          payload: {
            message: 'nested workflow update',
          },
        },
      },
    } as ChunkType;

    const inputStream = new ReadableStream<ChunkType>({
      start(controller) {
        controller.enqueue({
          type: 'workflow-start',
          runId: 'run-123',
          from: ChunkFrom.WORKFLOW,
          payload: { workflowId: 'workflow-xyz' },
        } as ChunkType);

        controller.enqueue(workflowChunk);
        controller.close();
      },
    });

    const transformedStream = inputStream.pipeThrough(WorkflowStreamToAISDKTransformer());
    const emittedChunks = await collectStream(transformedStream);

    const forwardedChunk = emittedChunks.find(chunk => chunk.type === 'workflow-step-output');
    expect(forwardedChunk).toMatchObject(workflowChunk);
  });
});
