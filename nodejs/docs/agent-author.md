# Agent Extension Authoring Guide

A precise, step-by-step reference for agents writing Copilot CLI extensions programmatically.

## Workflow

### Step 1: Scaffold the extension

Use the `extensions_manage` tool with `operation: "scaffold"`:

```
extensions_manage({ operation: "scaffold", name: "my-extension" })
```

This creates `.github/extensions/my-extension/extension.mjs` with a working skeleton.
For user-scoped extensions (persist across all repos), add `location: "user"`.

### Step 2: Edit the extension file

Modify the generated `extension.mjs` using `edit` or `create` tools. The file must:
- Be named `extension.mjs` (only `.mjs` is supported)
- Use ES module syntax (`import`/`export`)
- Call `extension.resumeSession(process.env.SESSION_ID, { ... })`
- Set `disableResume: true`

### Step 3: Reload extensions

```
extensions_reload({})
```

This stops all running extensions and re-discovers/re-launches them. New tools are available immediately in the same turn (mid-turn refresh).

### Step 4: Verify

```
extensions_manage({ operation: "list" })
extensions_manage({ operation: "inspect", name: "my-extension" })
```

Check that the extension loaded successfully and isn't marked as "failed".

---

## File Structure

```
.github/extensions/<name>/extension.mjs
```

Discovery rules:
- The CLI scans `.github/extensions/` relative to the git root
- It also scans the user's copilot config extensions directory
- Only immediate subdirectories are checked (not recursive)
- Each subdirectory must contain a file named `extension.mjs`
- Project extensions shadow user extensions on name collision

---

## Minimal Skeleton

```js
import { approveAll } from "@github/copilot-sdk";
import { extension } from "@github/copilot-sdk/extension";

await extension.resumeSession(process.env.SESSION_ID, {
    disableResume: true,           // Required — extensions attach to existing sessions
    onPermissionRequest: approveAll, // Required — handle permission requests
    tools: [],                     // Optional — custom tools
    hooks: {},                     // Optional — lifecycle hooks
});
```

---

## Registering Tools

```js
tools: [
    {
        name: "tool_name",           // Required. Must be globally unique across all extensions.
        description: "What it does", // Required. Shown to the agent in tool descriptions.
        parameters: {                // Optional. JSON Schema for the arguments.
            type: "object",
            properties: {
                arg1: { type: "string", description: "..." },
            },
            required: ["arg1"],
        },
        handler: async (args, invocation) => {
            // args: parsed arguments matching the schema
            // invocation.sessionId: current session ID
            // invocation.toolCallId: unique call ID
            // invocation.toolName: this tool's name
            //
            // Return value: string or ToolResultObject
            //   string → treated as success
            //   { textResultForLlm, resultType } → structured result
            //     resultType: "success" | "failure" | "rejected" | "denied"
            return `Result: ${args.arg1}`;
        },
    },
]
```

**Constraints:**
- Tool names must be unique across ALL loaded extensions. Collisions cause the second extension to fail to load.
- Handler must return a string or `{ textResultForLlm: string, resultType?: string }`.
- Handler receives `(args, invocation)` — the second argument has `sessionId`, `toolCallId`, `toolName`.
- Use `console.error()` for debug logging (stdout is reserved for JSON-RPC).

---

## Registering Hooks

```js
hooks: {
    onUserPromptSubmitted: async (input, invocation) => { ... },
    onPreToolUse: async (input, invocation) => { ... },
    onPostToolUse: async (input, invocation) => { ... },
    onSessionStart: async (input, invocation) => { ... },
    onSessionEnd: async (input, invocation) => { ... },
    onErrorOccurred: async (input, invocation) => { ... },
}
```

All hook inputs include `timestamp` (unix ms) and `cwd` (working directory).
All handlers receive `invocation: { sessionId: string }` as the second argument.
All handlers may return `void`/`undefined` (no-op) or an output object.

### onUserPromptSubmitted

**Input:** `{ prompt: string, timestamp, cwd }`

**Output (all fields optional):**
| Field | Type | Effect |
|-------|------|--------|
| `modifiedPrompt` | `string` | Replaces the user's prompt |
| `additionalContext` | `string` | Appended as hidden context the agent sees |

### onPreToolUse

**Input:** `{ toolName: string, toolArgs: unknown, timestamp, cwd }`

**Output (all fields optional):**
| Field | Type | Effect |
|-------|------|--------|
| `permissionDecision` | `"allow" \| "deny" \| "ask"` | Override the permission check |
| `permissionDecisionReason` | `string` | Shown to user if denied |
| `modifiedArgs` | `unknown` | Replaces the tool arguments |
| `additionalContext` | `string` | Injected into the conversation |

### onPostToolUse

**Input:** `{ toolName: string, toolArgs: unknown, toolResult: ToolResultObject, timestamp, cwd }`

**Output (all fields optional):**
| Field | Type | Effect |
|-------|------|--------|
| `modifiedResult` | `ToolResultObject` | Replaces the tool result |
| `additionalContext` | `string` | Injected into the conversation |

### onSessionStart

**Input:** `{ source: "startup" \| "resume" \| "new", initialPrompt?: string, timestamp, cwd }`

**Output (all fields optional):**
| Field | Type | Effect |
|-------|------|--------|
| `additionalContext` | `string` | Injected as initial context |

### onSessionEnd

**Input:** `{ reason: "complete" \| "error" \| "abort" \| "timeout" \| "user_exit", finalMessage?: string, error?: string, timestamp, cwd }`

**Output (all fields optional):**
| Field | Type | Effect |
|-------|------|--------|
| `sessionSummary` | `string` | Summary for session persistence |
| `cleanupActions` | `string[]` | Cleanup descriptions |

### onErrorOccurred

**Input:** `{ error: string, errorContext: "model_call" \| "tool_execution" \| "system" \| "user_input", recoverable: boolean, timestamp, cwd }`

**Output (all fields optional):**
| Field | Type | Effect |
|-------|------|--------|
| `errorHandling` | `"retry" \| "skip" \| "abort"` | How to handle the error |
| `retryCount` | `number` | Max retries (when errorHandling is "retry") |
| `userNotification` | `string` | Message shown to the user |

---

## Session Object

After `resumeSession()`, the returned `session` provides:

### session.send(options)

Send a message programmatically:
```js
await session.send({ prompt: "Analyze the test results." });
await session.send({
    prompt: "Review this file",
    attachments: [{ type: "file", path: "./src/index.ts" }],
});
```

### session.sendAndWait(options, timeout?)

Send and block until the agent finishes (resolves on `session.idle`):
```js
const response = await session.sendAndWait({ prompt: "What is 2+2?" });
console.error(response?.data.content);
```

### session.log(message, options?)

Log to the CLI timeline:
```js
await session.log("Extension ready");
await session.log("Rate limit approaching", { level: "warning" });
await session.log("Connection failed", { level: "error" });
await session.log("Processing...", { ephemeral: true }); // transient, not persisted
```

### session.on(eventType, handler)

Subscribe to session events. Returns an unsubscribe function.
```js
const unsub = session.on("tool.execution_complete", (event) => {
    console.error(`Tool ${event.data.toolName}: ${event.data.success}`);
});
```

### Key Event Types

| Event | Key Data Fields |
|-------|----------------|
| `assistant.message` | `content`, `messageId` |
| `tool.execution_start` | `toolCallId`, `toolName`, `arguments` |
| `tool.execution_complete` | `toolCallId`, `toolName`, `success`, `result`, `error` |
| `user.message` | `content`, `attachments`, `source` |
| `session.idle` | `backgroundTasks` |
| `session.error` | `errorType`, `message`, `stack` |
| `permission.requested` | `requestId`, `permissionRequest.kind` |
| `session.shutdown` | `shutdownType`, `totalPremiumRequests` |

### session.workspacePath

Path to the session workspace directory (checkpoints, plan.md, files/). `undefined` if infinite sessions disabled.

### session.rpc

Low-level typed RPC access to all session APIs (model, mode, plan, workspace, etc.).

---

## Gotchas

1. **stdout is reserved for JSON-RPC.** Use `console.error()` for debug output. `console.log()` will corrupt the protocol.
2. **Tool name collisions are fatal.** If two extensions register the same tool name, the second extension fails to initialize.
3. **`disableResume: true` is required.** Extensions always attach to existing sessions.
4. **Don't call `session.send()` synchronously from `onUserPromptSubmitted`.** Use `setTimeout(() => session.send(...), 0)` to avoid infinite loops.
5. **Extensions are reloaded on `/clear`.** Any in-memory state is lost between sessions.
6. **Only `.mjs` is supported.** TypeScript (`.ts`) is not yet supported.
7. **The handler's return value is the tool result.** Returning `undefined` sends an empty success. Throwing sends a failure with the error message.
