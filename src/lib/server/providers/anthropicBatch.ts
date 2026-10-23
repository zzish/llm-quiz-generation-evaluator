/**
 * Claude calls through the Message Batches API: the same requests at half the price, answered
 * asynchronously (most batches within an hour, at most 24 hours).
 *
 * The batch runner sends the expensive judge here. Results come back in any order, so every request
 * carries a custom id and every result is matched by it, never by position.
 */
import type Anthropic from "@anthropic-ai/sdk";
import { resolveModel } from "./registry.js";
import { anthropicParams, fromAnthropic } from "./requests.js";
import type { CallResult, ModelCall } from "./types.js";

/** One request in a batch. `customId` must match `^[a-zA-Z0-9_-]{1,64}$`. */
export interface BatchItem {
	customId: string;
	call: ModelCall;
}

/** What came back for one custom id: a result, or why there is none. */
export interface BatchOutcome {
	result?: CallResult;
	error?: string;
}

/** Submits the items as one batch and returns the batch id. */
export async function submitAnthropicBatch(client: Anthropic, items: BatchItem[]): Promise<string> {
	const batch = await client.messages.batches.create({
		requests: items.map((item) => ({
			custom_id: item.customId,
			params: anthropicParams(resolveModel(item.call.modelKey, item.call.reasoning), item.call),
		})),
	});
	return batch.id;
}

/** Whether the batch has finished, with its request counts. */
export async function anthropicBatchStatus(
	client: Anthropic,
	batchId: string,
): Promise<{ ended: boolean; counts: Anthropic.Messages.MessageBatchRequestCounts }> {
	const batch = await client.messages.batches.retrieve(batchId);
	return { ended: batch.processing_status === "ended", counts: batch.request_counts };
}

/**
 * Every result of a finished batch, keyed by custom id.
 *
 * Latency is reported as 0: a batch has no per-request timing, and summaries leave batch calls out of
 * latency figures.
 */
export async function anthropicBatchResults(client: Anthropic, batchId: string): Promise<Map<string, BatchOutcome>> {
	const outcomes = new Map<string, BatchOutcome>();
	for await (const item of await client.messages.batches.results(batchId)) {
		const result = item.result;
		if (result.type === "succeeded") {
			outcomes.set(item.custom_id, { result: fromAnthropic(result.message, 0) });
		} else if (result.type === "errored") {
			outcomes.set(item.custom_id, { error: `${result.error.error.type}: ${result.error.error.message}`.slice(0, 300) });
		} else {
			outcomes.set(item.custom_id, { error: result.type });
		}
	}
	return outcomes;
}
