/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { describe, expect, it, afterAll } from "vitest";
import { z } from "zod";
import { CopilotClient, defineTool, approveAll } from "../../src/index.js";
import type { SessionEvent } from "../../src/index.js";
import { createSdkTestContext } from "./harness/sdkTestContext";

describe("Multi-client broadcast", async () => {
    // Use TCP mode so a second client can connect to the same CLI process
    const ctx = await createSdkTestContext({ useStdio: false });
    const client1 = ctx.copilotClient;

    // Trigger connection so we can read the port
    const initSession = await client1.createSession({ onPermissionRequest: approveAll });
    await initSession.destroy();

    const actualPort = (client1 as unknown as { actualPort: number }).actualPort;
    const client2 = new CopilotClient({ cliUrl: `localhost:${actualPort}` });

    afterAll(async () => {
        await client2.stop();
    });

    it("both clients see tool request and completion events", async () => {
        const tool = defineTool("magic_number", {
            description: "Returns a magic number",
            parameters: z.object({
                seed: z.string().describe("A seed value"),
            }),
            handler: ({ seed }) => `MAGIC_${seed}_42`,
        });

        // Client 1 creates a session with a custom tool
        const session1 = await client1.createSession({
            onPermissionRequest: approveAll,
            tools: [tool],
        });

        // Client 2 resumes the same session (separate TCP connection, own handlers)
        const session2 = await client2.resumeSession(session1.sessionId, {
            onPermissionRequest: approveAll,
            tools: [tool],
        });

        // Track events seen by each client
        const client1Events: SessionEvent[] = [];
        const client2Events: SessionEvent[] = [];

        session1.on((event) => client1Events.push(event));
        session2.on((event) => client2Events.push(event));

        // Send a prompt that triggers the custom tool
        const response = await session1.sendAndWait({
            prompt: "Use the magic_number tool with seed 'hello' and tell me the result",
        });

        // The response should contain the tool's output
        expect(response?.data.content).toContain("MAGIC_hello_42");

        // Both clients should have seen the external_tool.requested event
        const client1ToolRequested = client1Events.filter(
            (e) => e.type === "external_tool.requested"
        );
        const client2ToolRequested = client2Events.filter(
            (e) => e.type === "external_tool.requested"
        );
        expect(client1ToolRequested.length).toBeGreaterThan(0);
        expect(client2ToolRequested.length).toBeGreaterThan(0);

        // Both clients should have seen the external_tool.completed event
        const client1ToolCompleted = client1Events.filter(
            (e) => e.type === "external_tool.completed"
        );
        const client2ToolCompleted = client2Events.filter(
            (e) => e.type === "external_tool.completed"
        );
        expect(client1ToolCompleted.length).toBeGreaterThan(0);
        expect(client2ToolCompleted.length).toBeGreaterThan(0);

        await session2.destroy();
    });

    it("one client approves permission and both see the result", async () => {
        const client1PermissionRequests: unknown[] = [];

        // Client 1 creates a session and manually approves permission requests
        const session1 = await client1.createSession({
            onPermissionRequest: (request) => {
                client1PermissionRequests.push(request);
                return { kind: "approved" as const };
            },
        });

        // Client 2 resumes the same session — its handler never resolves,
        // so only client 1's approval takes effect (no race)
        const session2 = await client2.resumeSession(session1.sessionId, {
            onPermissionRequest: () => new Promise(() => {}),
        });

        // Track events seen by each client
        const client1Events: SessionEvent[] = [];
        const client2Events: SessionEvent[] = [];

        session1.on((event) => client1Events.push(event));
        session2.on((event) => client2Events.push(event));

        // Send a prompt that triggers a write operation (requires permission)
        const response = await session1.sendAndWait({
            prompt: "Create a file called hello.txt containing the text 'hello world'",
        });

        expect(response?.data.content).toBeTruthy();

        // Client 1 should have handled the permission request
        expect(client1PermissionRequests.length).toBeGreaterThan(0);

        // Both clients should have seen permission.requested events
        const client1PermRequested = client1Events.filter(
            (e) => e.type === "permission.requested"
        );
        const client2PermRequested = client2Events.filter(
            (e) => e.type === "permission.requested"
        );
        expect(client1PermRequested.length).toBeGreaterThan(0);
        expect(client2PermRequested.length).toBeGreaterThan(0);

        // Both clients should have seen permission.completed events with approved result
        const client1PermCompleted = client1Events.filter(
            (e): e is SessionEvent & { type: "permission.completed" } => e.type === "permission.completed"
        );
        const client2PermCompleted = client2Events.filter(
            (e): e is SessionEvent & { type: "permission.completed" } => e.type === "permission.completed"
        );
        expect(client1PermCompleted.length).toBeGreaterThan(0);
        expect(client2PermCompleted.length).toBeGreaterThan(0);
        for (const event of [...client1PermCompleted, ...client2PermCompleted]) {
            expect(event.data.result.kind).toBe("approved");
        }

        await session2.destroy();
    });

    it("one client rejects permission and both see the result", async () => {
        // Client 1 creates a session and denies all permission requests
        const session1 = await client1.createSession({
            onPermissionRequest: () => ({ kind: "denied-interactively-by-user" as const }),
        });

        // Client 2 resumes — its handler never resolves so only client 1's denial takes effect
        const session2 = await client2.resumeSession(session1.sessionId, {
            onPermissionRequest: () => new Promise(() => {}),
        });

        const client1Events: SessionEvent[] = [];
        const client2Events: SessionEvent[] = [];

        session1.on((event) => client1Events.push(event));
        session2.on((event) => client2Events.push(event));

        // Ask the agent to write a file (requires permission)
        const { writeFile } = await import("fs/promises");
        const { join } = await import("path");
        const testFile = join(ctx.workDir, "protected.txt");
        await writeFile(testFile, "protected content");

        await session1.sendAndWait({
            prompt: "Edit protected.txt and replace 'protected' with 'hacked'.",
        });

        // Verify the file was NOT modified (permission was denied)
        const { readFile } = await import("fs/promises");
        const content = await readFile(testFile, "utf-8");
        expect(content).toBe("protected content");

        // Both clients should have seen permission.requested and permission.completed
        expect(client1Events.filter((e) => e.type === "permission.requested").length).toBeGreaterThan(0);
        expect(client2Events.filter((e) => e.type === "permission.requested").length).toBeGreaterThan(0);

        // Both clients should see the denial in the completed event
        const client1PermCompleted = client1Events.filter(
            (e): e is SessionEvent & { type: "permission.completed" } => e.type === "permission.completed"
        );
        const client2PermCompleted = client2Events.filter(
            (e): e is SessionEvent & { type: "permission.completed" } => e.type === "permission.completed"
        );
        expect(client1PermCompleted.length).toBeGreaterThan(0);
        expect(client2PermCompleted.length).toBeGreaterThan(0);
        for (const event of [...client1PermCompleted, ...client2PermCompleted]) {
            expect(event.data.result.kind).toBe("denied-interactively-by-user");
        }

        await session2.destroy();
    });
});
