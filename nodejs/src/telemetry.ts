/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

/**
 * OpenTelemetry trace-context helpers.
 *
 * `@opentelemetry/api` is an optional peer dependency.  When it is not
 * installed the helpers gracefully degrade to no-ops.
 *
 * @module telemetry
 */

interface TraceContext {
    traceparent?: string;
    tracestate?: string;
}

type OtelApi = typeof import("@opentelemetry/api");

let otelPromise: Promise<OtelApi | undefined> | undefined;

function loadOtelApi(): Promise<OtelApi | undefined> {
    if (!otelPromise) {
        otelPromise = import("@opentelemetry/api").catch(() => undefined);
    }
    return otelPromise;
}

/**
 * Returns the current W3C Trace Context (`traceparent` / `tracestate`)
 * extracted from the active OpenTelemetry context.  Returns `{}` when
 * the OTel API is not available.
 */
export async function getTraceContext(): Promise<TraceContext> {
    const api = await loadOtelApi();
    if (!api) return {};

    const carrier: Record<string, string> = {};
    api.propagation.inject(api.context.active(), carrier);

    const result: TraceContext = {};
    if (carrier.traceparent) result.traceparent = carrier.traceparent;
    if (carrier.tracestate) result.tracestate = carrier.tracestate;
    return result;
}

/**
 * Runs `fn` inside an OpenTelemetry context restored from the given
 * `traceparent` / `tracestate` values.  If the OTel API is not available
 * or `traceparent` is `undefined`, `fn` is called directly.
 */
export async function withTraceContext<T>(
    traceparent: string | undefined,
    tracestate: string | undefined,
    fn: () => T
): Promise<Awaited<T>> {
    const api = await loadOtelApi();
    if (!api || !traceparent) return fn() as Awaited<T>;

    const carrier: Record<string, string> = { traceparent };
    if (tracestate) carrier.tracestate = tracestate;

    const extractedContext = api.propagation.extract(api.context.active(), carrier);
    return api.context.with(extractedContext, fn) as Awaited<T>;
}
