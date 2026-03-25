/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it, onTestFinished, vi } from "vitest";
import { CopilotClient } from "../../src/client.js";
import { approveAll, type SessionEvent, type SessionDataStoreConfig } from "../../src/index.js";
import { createSdkTestContext } from "./harness/sdkTestContext.js";

/**
 * In-memory session event store for testing.
 * Stores events in a Map keyed by sessionId, and tracks call counts
 * for each operation so tests can assert they were invoked.
 */
class InMemorySessionStore {
    private sessions = new Map<string, SessionEvent[]>();
    readonly calls = {
        load: 0,
        append: 0,
        truncate: 0,
        listSessions: 0,
        delete: 0,
    };

    toConfig(descriptor: string): SessionDataStoreConfig {
        return {
            descriptor,
            load: async ({ sessionId }) => {
                this.calls.load++;
                const events = this.sessions.get(sessionId) ?? [];
                return { events: events as Record<string, unknown>[] };
            },
            append: async ({ sessionId, events }) => {
                this.calls.append++;
                const existing = this.sessions.get(sessionId) ?? [];
                existing.push(...(events as unknown as SessionEvent[]));
                this.sessions.set(sessionId, existing);
            },
            truncate: async ({ sessionId, upToEventId }) => {
                this.calls.truncate++;
                const existing = this.sessions.get(sessionId) ?? [];
                const idx = existing.findIndex((e) => e.id === upToEventId);
                if (idx === -1) {
                    return { eventsRemoved: 0, eventsKept: existing.length };
                }
                const kept = existing.slice(idx + 1);
                this.sessions.set(sessionId, kept);
                return { eventsRemoved: idx + 1, eventsKept: kept.length };
            },
            list: async () => {
                this.calls.listSessions++;
                const now = new Date().toISOString();
                return {
                    sessions: Array.from(this.sessions.keys()).map((sessionId) => ({
                        sessionId,
                        mtime: now,
                        birthtime: now,
                    })),
                };
            },
            delete: async ({ sessionId }) => {
                this.calls.delete++;
                this.sessions.delete(sessionId);
            },
        };
    }

    getEvents(sessionId: string): SessionEvent[] {
        return this.sessions.get(sessionId) ?? [];
    }

    hasSession(sessionId: string): boolean {
        return this.sessions.has(sessionId);
    }

    get sessionCount(): number {
        return this.sessions.size;
    }
}

// These tests require a runtime built with sessionDataStore support.
// Skip when COPILOT_CLI_PATH is not set (CI uses the published CLI which
// doesn't include this feature yet).
const runTests = process.env.COPILOT_CLI_PATH ? describe : describe.skip;

runTests("Session Data Store", async () => {
    const { env } = await createSdkTestContext();

    it("should persist events to a client-supplied store", async () => {
        const store = new InMemorySessionStore();
        const client1 = new CopilotClient({
            env,
            logLevel: "error",
            cliPath: process.env.COPILOT_CLI_PATH,
            sessionDataStore: store.toConfig("memory://test-persist"),
        });
        onTestFinished(() => client1.forceStop());

        const session = await client1.createSession({
            onPermissionRequest: approveAll,
        });

        // Send a message and wait for the response
        const msg = await session.sendAndWait({ prompt: "What is 100 + 200?" });
        expect(msg?.data.content).toContain("300");

        // Verify onAppend was called — events should have been routed to our store.
        // The SessionWriter uses debounced flushing, so poll until events arrive.
        await vi.waitFor(
            () => {
                const events = store.getEvents(session.sessionId);
                const eventTypes = events.map((e) => e.type);
                expect(eventTypes).toContain("session.start");
                expect(eventTypes).toContain("user.message");
                expect(eventTypes).toContain("assistant.message");
            },
            { timeout: 10_000, interval: 200 }
        );
        expect(store.calls.append).toBeGreaterThan(0);
    });

    it("should load events from store on resume", async () => {
        const store = new InMemorySessionStore();

        const client2 = new CopilotClient({
            env,
            logLevel: "error",
            cliPath: process.env.COPILOT_CLI_PATH,
            sessionDataStore: store.toConfig("memory://test-resume"),
        });
        onTestFinished(() => client2.forceStop());

        // Create a session and send a message
        const session1 = await client2.createSession({
            onPermissionRequest: approveAll,
        });
        const sessionId = session1.sessionId;

        const msg1 = await session1.sendAndWait({ prompt: "What is 50 + 50?" });
        expect(msg1?.data.content).toContain("100");
        await session1.disconnect();

        // Verify onLoad is called when resuming
        const loadCountBefore = store.calls.load;
        const session2 = await client2.resumeSession(sessionId, {
            onPermissionRequest: approveAll,
        });

        expect(store.calls.load).toBeGreaterThan(loadCountBefore);

        // Send another message to verify the session is functional
        const msg2 = await session2.sendAndWait({ prompt: "What is that times 3?" });
        expect(msg2?.data.content).toContain("300");
    });

    it("should list sessions from the data store", async () => {
        const store = new InMemorySessionStore();

        const client3 = new CopilotClient({
            env,
            logLevel: "error",
            cliPath: process.env.COPILOT_CLI_PATH,
            sessionDataStore: store.toConfig("memory://test-list"),
        });
        onTestFinished(() => client3.forceStop());

        // Create a session and send a message to trigger event flushing
        const session = await client3.createSession({
            onPermissionRequest: approveAll,
        });
        await session.sendAndWait({ prompt: "What is 10 + 10?" });

        // Wait for events to be flushed (debounced)
        await vi.waitFor(() => expect(store.hasSession(session.sessionId)).toBe(true), {
            timeout: 10_000,
            interval: 200,
        });

        // List sessions — should come from our store
        const sessions = await client3.listSessions();
        expect(store.calls.listSessions).toBeGreaterThan(0);
        expect(sessions.some((s) => s.sessionId === session.sessionId)).toBe(true);
    });

    it("should call onDelete when deleting a session", async () => {
        const store = new InMemorySessionStore();

        const client4 = new CopilotClient({
            env,
            logLevel: "error",
            cliPath: process.env.COPILOT_CLI_PATH,
            sessionDataStore: store.toConfig("memory://test-delete"),
        });
        onTestFinished(() => client4.forceStop());

        const session = await client4.createSession({
            onPermissionRequest: approveAll,
        });
        const sessionId = session.sessionId;

        // Send a message to create some events
        await session.sendAndWait({ prompt: "What is 7 + 7?" });

        // Wait for events to flush
        await vi.waitFor(() => expect(store.hasSession(sessionId)).toBe(true), {
            timeout: 10_000,
            interval: 200,
        });

        expect(store.calls.delete).toBe(0);

        // Delete the session
        await client4.deleteSession(sessionId);

        // Verify onDelete was called and the session was removed from our store
        expect(store.calls.delete).toBeGreaterThan(0);
        expect(store.hasSession(sessionId)).toBe(false);
    });

    it("should reject sessionDataStore when sessions already exist", async () => {
        // First client uses TCP so a second client can connect to the same runtime
        const client5 = new CopilotClient({
            env,
            logLevel: "error",
            cliPath: process.env.COPILOT_CLI_PATH,
            useStdio: false,
        });
        onTestFinished(() => client5.forceStop());

        const session = await client5.createSession({
            onPermissionRequest: approveAll,
        });
        await session.sendAndWait({ prompt: "Hello" });

        // Get the port the first client's runtime is listening on
        const port = (client5 as unknown as { actualPort: number }).actualPort;

        // Second client tries to connect with a data store — should fail
        // because sessions already exist on the runtime.
        const store = new InMemorySessionStore();
        const client6 = new CopilotClient({
            env,
            logLevel: "error",
            cliUrl: `localhost:${port}`,
            sessionDataStore: store.toConfig("memory://too-late"),
        });
        onTestFinished(() => client6.forceStop());

        await expect(client6.start()).rejects.toThrow();
    });
});
