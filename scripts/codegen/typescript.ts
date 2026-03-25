/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

/**
 * TypeScript code generator for session-events and RPC types.
 */

import fs from "fs/promises";
import type { JSONSchema7 } from "json-schema";
import { compile } from "json-schema-to-typescript";
import {
    getSessionEventsSchemaPath,
    getApiSchemaPath,
    postProcessSchema,
    writeGeneratedFile,
    isRpcMethod,
    isNodeFullyExperimental,
    type ApiSchema,
    type RpcMethod,
} from "./utils.js";

// ── Utilities ───────────────────────────────────────────────────────────────

function toPascalCase(s: string): string {
    return s.charAt(0).toUpperCase() + s.slice(1);
}

function collectRpcMethods(node: Record<string, unknown>): RpcMethod[] {
    const results: RpcMethod[] = [];
    for (const value of Object.values(node)) {
        if (isRpcMethod(value)) {
            results.push(value);
        } else if (typeof value === "object" && value !== null) {
            results.push(...collectRpcMethods(value as Record<string, unknown>));
        }
    }
    return results;
}

// ── Session Events ──────────────────────────────────────────────────────────

async function generateSessionEvents(schemaPath?: string): Promise<void> {
    console.log("TypeScript: generating session-events...");

    const resolvedPath = schemaPath ?? (await getSessionEventsSchemaPath());
    const schema = JSON.parse(await fs.readFile(resolvedPath, "utf-8")) as JSONSchema7;
    const processed = postProcessSchema(schema);

    const ts = await compile(processed, "SessionEvent", {
        bannerComment: `/**
 * AUTO-GENERATED FILE - DO NOT EDIT
 * Generated from: session-events.schema.json
 */`,
        style: { semi: true, singleQuote: false, trailingComma: "all" },
        additionalProperties: false,
    });

    const outPath = await writeGeneratedFile("nodejs/src/generated/session-events.ts", ts);
    console.log(`  ✓ ${outPath}`);
}

// ── RPC Types ───────────────────────────────────────────────────────────────

function resultTypeName(rpcMethod: string): string {
    return rpcMethod.split(".").map(toPascalCase).join("") + "Result";
}

function paramsTypeName(rpcMethod: string): string {
    return rpcMethod.split(".").map(toPascalCase).join("") + "Params";
}

async function generateRpc(schemaPath?: string): Promise<void> {
    console.log("TypeScript: generating RPC types...");

    const resolvedPath = schemaPath ?? (await getApiSchemaPath());
    const schema = JSON.parse(await fs.readFile(resolvedPath, "utf-8")) as ApiSchema;

    const lines: string[] = [];
    lines.push(`/**
 * AUTO-GENERATED FILE - DO NOT EDIT
 * Generated from: api.schema.json
 */

import type { MessageConnection } from "vscode-jsonrpc/node.js";
`);

    const allMethods = [...collectRpcMethods(schema.server || {}), ...collectRpcMethods(schema.session || {})];
    const clientMethods = collectRpcMethods(schema.client || {});

    for (const method of [...allMethods, ...clientMethods]) {
        if (method.result) {
            const compiled = await compile(method.result, resultTypeName(method.rpcMethod), {
                bannerComment: "",
                additionalProperties: false,
            });
            if (method.stability === "experimental") {
                lines.push("/** @experimental */");
            }
            lines.push(compiled.trim());
            lines.push("");
        }

        if (method.params?.properties && Object.keys(method.params.properties).length > 0) {
            const paramsCompiled = await compile(method.params, paramsTypeName(method.rpcMethod), {
                bannerComment: "",
                additionalProperties: false,
            });
            if (method.stability === "experimental") {
                lines.push("/** @experimental */");
            }
            lines.push(paramsCompiled.trim());
            lines.push("");
        }
    }

    // Generate factory functions
    if (schema.server) {
        lines.push(`/** Create typed server-scoped RPC methods (no session required). */`);
        lines.push(`export function createServerRpc(connection: MessageConnection) {`);
        lines.push(`    return {`);
        lines.push(...emitGroup(schema.server, "        ", false));
        lines.push(`    };`);
        lines.push(`}`);
        lines.push("");
    }

    if (schema.session) {
        lines.push(`/** Create typed session-scoped RPC methods. */`);
        lines.push(`export function createSessionRpc(connection: MessageConnection, sessionId: string) {`);
        lines.push(`    return {`);
        lines.push(...emitGroup(schema.session, "        ", true));
        lines.push(`    };`);
        lines.push(`}`);
        lines.push("");
    }

    // Generate client API handler interfaces and registration function
    if (schema.client) {
        lines.push(...emitClientApiHandlers(schema.client));
    }

    const outPath = await writeGeneratedFile("nodejs/src/generated/rpc.ts", lines.join("\n"));
    console.log(`  ✓ ${outPath}`);
}

function emitGroup(node: Record<string, unknown>, indent: string, isSession: boolean, parentExperimental = false): string[] {
    const lines: string[] = [];
    for (const [key, value] of Object.entries(node)) {
        if (isRpcMethod(value)) {
            const { rpcMethod, params } = value;
            const resultType = resultTypeName(rpcMethod);
            const paramsType = paramsTypeName(rpcMethod);

            const paramEntries = params?.properties ? Object.entries(params.properties).filter(([k]) => k !== "sessionId") : [];
            const hasParams = params?.properties && Object.keys(params.properties).length > 0;
            const hasNonSessionParams = paramEntries.length > 0;

            const sigParams: string[] = [];
            let bodyArg: string;

            if (isSession) {
                if (hasNonSessionParams) {
                    sigParams.push(`params: Omit<${paramsType}, "sessionId">`);
                    bodyArg = "{ sessionId, ...params }";
                } else {
                    bodyArg = "{ sessionId }";
                }
            } else {
                if (hasParams) {
                    sigParams.push(`params: ${paramsType}`);
                    bodyArg = "params";
                } else {
                    bodyArg = "{}";
                }
            }

            if ((value as RpcMethod).stability === "experimental" && !parentExperimental) {
                lines.push(`${indent}/** @experimental */`);
            }
            lines.push(`${indent}${key}: async (${sigParams.join(", ")}): Promise<${resultType}> =>`);
            lines.push(`${indent}    connection.sendRequest("${rpcMethod}", ${bodyArg}),`);
        } else if (typeof value === "object" && value !== null) {
            const groupExperimental = isNodeFullyExperimental(value as Record<string, unknown>);
            if (groupExperimental) {
                lines.push(`${indent}/** @experimental */`);
            }
            lines.push(`${indent}${key}: {`);
            lines.push(...emitGroup(value as Record<string, unknown>, indent + "    ", isSession, groupExperimental));
            lines.push(`${indent}},`);
        }
    }
    return lines;
}

// ── Client API Handler Generation ───────────────────────────────────────────

/**
 * Collect client API methods grouped by their top-level namespace.
 * Returns a map like: { sessionStore: [{ rpcMethod, params, result }, ...] }
 */
function collectClientGroups(node: Record<string, unknown>): Map<string, RpcMethod[]> {
    const groups = new Map<string, RpcMethod[]>();
    for (const [groupName, groupNode] of Object.entries(node)) {
        if (typeof groupNode === "object" && groupNode !== null) {
            groups.set(groupName, collectRpcMethods(groupNode as Record<string, unknown>));
        }
    }
    return groups;
}

/**
 * Derive the handler method name from the full RPC method name.
 * e.g., "sessionStore.load" → "load"
 */
function handlerMethodName(rpcMethod: string): string {
    const parts = rpcMethod.split(".");
    return parts[parts.length - 1];
}

/**
 * Generate handler interfaces and a registration function for client API groups.
 */
function emitClientApiHandlers(clientSchema: Record<string, unknown>): string[] {
    const lines: string[] = [];
    const groups = collectClientGroups(clientSchema);

    // Emit a handler interface per group
    for (const [groupName, methods] of groups) {
        const interfaceName = toPascalCase(groupName) + "Handler";
        lines.push(`/**`);
        lines.push(` * Handler interface for the \`${groupName}\` client API group.`);
        lines.push(` * Implement this to provide a custom ${groupName} backend.`);
        lines.push(` */`);
        lines.push(`export interface ${interfaceName} {`);

        for (const method of methods) {
            const name = handlerMethodName(method.rpcMethod);
            const hasParams = method.params?.properties && Object.keys(method.params.properties).length > 0;
            const pType = hasParams ? paramsTypeName(method.rpcMethod) : "";
            const rType = method.result ? resultTypeName(method.rpcMethod) : "void";

            const sig = hasParams
                ? `    ${name}(params: ${pType}): Promise<${rType}>;`
                : `    ${name}(): Promise<${rType}>;`;
            lines.push(sig);
        }

        lines.push(`}`);
        lines.push("");
    }

    // Emit combined ClientApiHandlers type
    lines.push(`/** All client API handler groups. Each group is optional. */`);
    lines.push(`export interface ClientApiHandlers {`);
    for (const [groupName] of groups) {
        const interfaceName = toPascalCase(groupName) + "Handler";
        lines.push(`    ${groupName}?: ${interfaceName};`);
    }
    lines.push(`}`);
    lines.push("");

    // Emit registration function
    lines.push(`/**`);
    lines.push(` * Register client API handlers on a JSON-RPC connection.`);
    lines.push(` * The server calls these methods to delegate work to the client.`);
    lines.push(` * Methods for unregistered groups will respond with a standard JSON-RPC`);
    lines.push(` * method-not-found error.`);
    lines.push(` */`);
    lines.push(`export function registerClientApiHandlers(`);
    lines.push(`    connection: MessageConnection,`);
    lines.push(`    handlers: ClientApiHandlers,`);
    lines.push(`): void {`);

    for (const [groupName, methods] of groups) {
        lines.push(`    if (handlers.${groupName}) {`);
        lines.push(`        const h = handlers.${groupName}!;`);

        for (const method of methods) {
            const name = handlerMethodName(method.rpcMethod);
            const hasParams = method.params?.properties && Object.keys(method.params.properties).length > 0;
            const pType = hasParams ? paramsTypeName(method.rpcMethod) : "";

            if (hasParams) {
                lines.push(`        connection.onRequest("${method.rpcMethod}", (params: ${pType}) => h.${name}(params));`);
            } else {
                lines.push(`        connection.onRequest("${method.rpcMethod}", () => h.${name}());`);
            }
        }

        lines.push(`    }`);
    }

    lines.push(`}`);
    lines.push("");

    return lines;
}

// ── Main ────────────────────────────────────────────────────────────────────

async function generate(sessionSchemaPath?: string, apiSchemaPath?: string): Promise<void> {
    await generateSessionEvents(sessionSchemaPath);
    try {
        await generateRpc(apiSchemaPath);
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT" && !apiSchemaPath) {
            console.log("TypeScript: skipping RPC (api.schema.json not found)");
        } else {
            throw err;
        }
    }
}

const sessionArg = process.argv[2] || undefined;
const apiArg = process.argv[3] || undefined;
generate(sessionArg, apiArg).catch((err) => {
    console.error("TypeScript generation failed:", err);
    process.exit(1);
});
