/**
 * Dual ESM/CJS build compatibility tests
 *
 * Verifies that both the ESM and CJS builds exist and work correctly,
 * so consumers using either module system get a working package.
 *
 * See: https://github.com/github/copilot-sdk/issues/528
 */

import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const distDir = join(import.meta.dirname, "../dist");

describe("Dual ESM/CJS build (#528)", () => {
    it("ESM dist file should exist", () => {
        expect(existsSync(join(distDir, "index.js"))).toBe(true);
    });

    it("CJS dist file should exist", () => {
        expect(existsSync(join(distDir, "cjs/index.js"))).toBe(true);
    });

    it("CJS build is requireable and exports CopilotClient", () => {
        const script = `
            const sdk = require(${JSON.stringify(join(distDir, "cjs/index.js"))});
            if (typeof sdk.CopilotClient !== 'function') {
                console.error('CopilotClient is not a function');
                process.exit(1);
            }
            console.log('CJS require: OK');
        `;
        const output = execFileSync(
            process.execPath,
            ["--eval", script],
            {
                encoding: "utf-8",
                timeout: 10000,
                cwd: join(import.meta.dirname, ".."),
            },
        );
        expect(output).toContain("CJS require: OK");
    });

    it("CopilotClient constructor works in CJS context", () => {
        const script = `
            const sdk = require(${JSON.stringify(join(distDir, "cjs/index.js"))});
            try {
                const client = new sdk.CopilotClient({ cliUrl: "http://localhost:8080" });
                console.log('CopilotClient constructor: OK');
            } catch (e) {
                console.error('constructor failed:', e.message);
                process.exit(1);
            }
        `;
        const output = execFileSync(
            process.execPath,
            ["--eval", script],
            {
                encoding: "utf-8",
                timeout: 10000,
                cwd: join(import.meta.dirname, ".."),
            },
        );
        expect(output).toContain("CopilotClient constructor: OK");
    });
});
