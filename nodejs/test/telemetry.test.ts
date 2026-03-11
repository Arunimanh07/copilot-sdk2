/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from "vitest";
import { getTraceContext, withTraceContext } from "../src/telemetry.js";

describe("telemetry", () => {
    describe("getTraceContext", () => {
        it("returns empty object when OTel is not configured", async () => {
            const ctx = await getTraceContext();
            // Without an active span / propagator the carrier stays empty
            expect(ctx).toEqual({});
        });
    });

    describe("withTraceContext", () => {
        it("calls fn directly when traceparent is undefined", async () => {
            let called = false;
            const result = await withTraceContext(undefined, undefined, () => {
                called = true;
                return 42;
            });
            expect(called).toBe(true);
            expect(result).toBe(42);
        });

        it("calls fn directly when traceparent is undefined (async fn)", async () => {
            const result = await withTraceContext(undefined, undefined, async () => {
                return "hello";
            });
            expect(result).toBe("hello");
        });

        it("calls fn when traceparent is provided (graceful without OTel SDK)", async () => {
            // Even if @opentelemetry/api is installed, without a configured propagator
            // the context won't carry anything — but the function should still run.
            const result = await withTraceContext(
                "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
                undefined,
                () => "ok"
            );
            expect(result).toBe("ok");
        });
    });

    describe("TelemetryConfig env var mapping", () => {
        it("sets correct env vars for full telemetry config", async () => {
            // Simulate what client.ts does with telemetry config
            const telemetry = {
                otlpEndpoint: "http://localhost:4318",
                filePath: "/tmp/traces.jsonl",
                exporterType: "otlp-http",
                sourceName: "my-app",
                captureContent: true,
            };

            const env: Record<string, string | undefined> = {};

            // Mirror the logic in client.ts startCLIServer
            if (telemetry) {
                const t = telemetry;
                env.COPILOT_OTEL_ENABLED = "true";
                if (t.otlpEndpoint !== undefined) env.OTEL_EXPORTER_OTLP_ENDPOINT = t.otlpEndpoint;
                if (t.filePath !== undefined) env.COPILOT_OTEL_FILE_EXPORTER_PATH = t.filePath;
                if (t.exporterType !== undefined) env.COPILOT_OTEL_EXPORTER_TYPE = t.exporterType;
                if (t.sourceName !== undefined) env.COPILOT_OTEL_SOURCE_NAME = t.sourceName;
                if (t.captureContent !== undefined)
                    env.OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT = String(
                        t.captureContent
                    );
            }

            expect(env).toEqual({
                COPILOT_OTEL_ENABLED: "true",
                OTEL_EXPORTER_OTLP_ENDPOINT: "http://localhost:4318",
                COPILOT_OTEL_FILE_EXPORTER_PATH: "/tmp/traces.jsonl",
                COPILOT_OTEL_EXPORTER_TYPE: "otlp-http",
                COPILOT_OTEL_SOURCE_NAME: "my-app",
                OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT: "true",
            });
        });

        it("only sets COPILOT_OTEL_ENABLED for empty telemetry config", async () => {
            const telemetry = {};
            const env: Record<string, string | undefined> = {};

            if (telemetry) {
                const t = telemetry as any;
                env.COPILOT_OTEL_ENABLED = "true";
                if (t.otlpEndpoint !== undefined) env.OTEL_EXPORTER_OTLP_ENDPOINT = t.otlpEndpoint;
                if (t.filePath !== undefined) env.COPILOT_OTEL_FILE_EXPORTER_PATH = t.filePath;
                if (t.exporterType !== undefined) env.COPILOT_OTEL_EXPORTER_TYPE = t.exporterType;
                if (t.sourceName !== undefined) env.COPILOT_OTEL_SOURCE_NAME = t.sourceName;
                if (t.captureContent !== undefined)
                    env.OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT = String(
                        t.captureContent
                    );
            }

            expect(env).toEqual({
                COPILOT_OTEL_ENABLED: "true",
            });
        });

        it("converts captureContent false to string 'false'", async () => {
            const telemetry = { captureContent: false };
            const env: Record<string, string | undefined> = {};

            env.COPILOT_OTEL_ENABLED = "true";
            if (telemetry.captureContent !== undefined)
                env.OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT = String(
                    telemetry.captureContent
                );

            expect(env.OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT).toBe("false");
        });
    });
});
