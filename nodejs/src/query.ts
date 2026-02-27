/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

/**
 * `query()` — a convenience wrapper that provides a simple async-iterator API
 * over the Copilot SDK.  It creates a client + session, sends a prompt, and
 * yields every {@link SessionEvent} as it arrives.
 *
 * @example
 * ```typescript
 * import { query, defineTool } from "@github/copilot-sdk";
 *
 * for await (const event of query({ prompt: "Hello!", tools: [myTool] })) {
 *     if (event.type === "assistant.message_delta") {
 *         process.stdout.write(event.data.deltaContent);
 *     }
 * }
 * ```
 *
 * @module query
 */

import { CopilotClient } from "./client.js";
import { approveAll, type QueryOptions, type SessionEvent } from "./types.js";

/**
 * Send a prompt and yield every session event as an async iterator.
 *
 * Internally creates a {@link CopilotClient} and session, sends the prompt,
 * and tears everything down when the iterator finishes or is broken out of.
 *
 * The generator ends when:
 * - The session becomes idle (model finished), or
 * - `maxTurns` tool-calling turns have been reached, or
 * - The consumer breaks out of the `for await` loop.
 */
export async function* query(options: QueryOptions): AsyncGenerator<SessionEvent> {
    const cliUrl = options.cliUrl ?? process.env.COPILOT_CLI_URL;
    const client = new CopilotClient({
        ...(cliUrl ? { cliUrl } : {}),
        ...(options.cliPath ? { cliPath: options.cliPath } : {}),
        ...(options.githubToken ? { githubToken: options.githubToken } : {}),
    });

    try {
        const session = await client.createSession({
            model: options.model,
            tools: options.tools ?? [],
            streaming: options.streaming ?? true,
            systemMessage: options.systemMessage,
            onPermissionRequest: options.onPermissionRequest ?? approveAll,
        });

        // Bridge the event-driven API to an async iterator via a simple queue.
        let resolve: ((value: IteratorResult<SessionEvent>) => void) | null = null;
        const buffer: SessionEvent[] = [];
        let done = false;
        let turns = 0;

        const finish = () => {
            done = true;
            if (resolve) {
                resolve({ value: undefined as unknown as SessionEvent, done: true });
                resolve = null;
            }
        };

        session.on((event: SessionEvent) => {
            if (done) return;

            // Count tool-calling turns for maxTurns support.
            if (
                options.maxTurns &&
                event.type === "assistant.message" &&
                event.data.toolRequests?.length
            ) {
                turns++;
                if (turns >= options.maxTurns) {
                    if (resolve) {
                        resolve({ value: event, done: false });
                        resolve = null;
                    } else {
                        buffer.push(event);
                    }
                    finish();
                    return;
                }
            }

            if (event.type === "session.idle") {
                if (resolve) {
                    resolve({ value: event, done: false });
                    resolve = null;
                } else {
                    buffer.push(event);
                }
                finish();
                return;
            }

            if (resolve) {
                resolve({ value: event, done: false });
                resolve = null;
            } else {
                buffer.push(event);
            }
        });

        await session.send({ prompt: options.prompt });

        while (!done || buffer.length > 0) {
            if (buffer.length > 0) {
                yield buffer.shift()!;
            } else if (done) {
                break;
            } else {
                yield await new Promise<SessionEvent>((r) => {
                    resolve = (result) => {
                        if (result.done) {
                            r(undefined as unknown as SessionEvent);
                        } else {
                            r(result.value);
                        }
                    };
                });
            }
        }
    } finally {
        await client.stop();
    }
}
