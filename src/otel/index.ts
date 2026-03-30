import {
	context,
	metrics,
	type Span,
	SpanStatusCode,
	trace,
} from "@opentelemetry/api";
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
	MeterProvider,
	PeriodicExportingMetricReader,
} from "@opentelemetry/sdk-metrics";
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import {
	ATTR_SERVICE_NAME,
	ATTR_SERVICE_VERSION,
} from "@opentelemetry/semantic-conventions";
import type { AgentConfig } from "../schemas/config.js";

const SERVICE_NAME = "adlc-harness";
const SERVICE_VERSION = "0.1.0";

export interface OtelContext {
	tracer: ReturnType<typeof trace.getTracer>;
	meter: ReturnType<typeof metrics.getMeter>;
	startSpan: (
		name: string,
		options?: {
			parent?: Span;
			attributes?: Record<string, string | number>;
		},
	) => Span;
	shutdown: () => Promise<void>;
}

export function createOtelContext(config: AgentConfig): OtelContext {
	const resource = resourceFromAttributes({
		[ATTR_SERVICE_NAME]: SERVICE_NAME,
		[ATTR_SERVICE_VERSION]: SERVICE_VERSION,
	});

	const traceExporter = new OTLPTraceExporter({
		url: `${config.otelEndpoint}/v1/traces`,
	});

	const tracerProvider = new NodeTracerProvider({
		resource,
		spanProcessors: [new BatchSpanProcessor(traceExporter)],
	});
	tracerProvider.register();

	const metricExporter = new OTLPMetricExporter({
		url: `${config.otelEndpoint}/v1/metrics`,
	});

	const metricReader = new PeriodicExportingMetricReader({
		exporter: metricExporter,
		exportIntervalMillis: 10_000,
	});

	const meterProvider = new MeterProvider({
		resource,
		readers: [metricReader],
	});

	const tracer = trace.getTracer(SERVICE_NAME, SERVICE_VERSION);
	const meter = meterProvider.getMeter(SERVICE_NAME, SERVICE_VERSION);

	return {
		tracer,
		meter,
		startSpan(name, options) {
			if (options?.parent) {
				const ctx = trace.setSpan(context.active(), options.parent);
				return tracer.startSpan(name, { attributes: options.attributes }, ctx);
			}
			return tracer.startSpan(name, { attributes: options?.attributes });
		},
		async shutdown() {
			await tracerProvider.shutdown();
			await meterProvider.shutdown();
		},
	};
}

/** No-op OTel context for when observability is disabled */
export function createNoopOtelContext(): OtelContext {
	const noopSpan: Span = {
		spanContext: () => ({
			traceId: "0".repeat(32),
			spanId: "0".repeat(16),
			traceFlags: 0,
		}),
		setAttribute: () => noopSpan,
		setAttributes: () => noopSpan,
		addEvent: () => noopSpan,
		addLink: () => noopSpan,
		addLinks: () => noopSpan,
		setStatus: () => noopSpan,
		updateName: () => noopSpan,
		end: () => {},
		isRecording: () => false,
		recordException: () => {},
	};

	return {
		tracer: trace.getTracer("noop"),
		meter: metrics.getMeter("noop"),
		startSpan: () => noopSpan,
		shutdown: async () => {},
	};
}

export { type Span, SpanStatusCode };
