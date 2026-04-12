import { describe, expect, test } from "bun:test";

const REPO_ROOT = new URL("../../", import.meta.url);

async function readRepoFile(relPath: string): Promise<string> {
	return Bun.file(new URL(relPath, REPO_ROOT)).text();
}

describe("otel-collector-config.yaml", () => {
	test("wires OTLP receivers to Jaeger traces and Prometheus metrics", async () => {
		const text = await readRepoFile("otel-collector-config.yaml");
		expect(text).toContain("receivers:");
		expect(text).toContain("otlp:");
		expect(text).toMatch(/grpc:\s*\n\s+endpoint:\s*0\.0\.0\.0:4317/);
		expect(text).toMatch(/http:\s*\n\s+endpoint:\s*0\.0\.0\.0:4318/);
		expect(text).toContain("otlp/jaeger:");
		expect(text).toContain("endpoint: jaeger:4317");
		expect(text).toMatch(/prometheus:\s*\n\s+endpoint:\s*0\.0\.0\.0:8889/);
		expect(text).toContain("exporters: [otlp/jaeger]");
		expect(text).toContain("exporters: [prometheus]");
	});
});

describe("prometheus/prometheus.yml", () => {
	test("scrapes the otel-collector job", async () => {
		const text = await readRepoFile("prometheus/prometheus.yml");
		expect(text).toContain("job_name: 'otel-collector'");
		expect(text).toContain("scrape_interval: 15s");
		expect(text).toContain("otel-collector:8889");
	});
});

describe("docker-compose.yml", () => {
	test("declares jaeger, otel-collector, and prometheus services", async () => {
		const text = await readRepoFile("docker-compose.yml");
		expect(text).toContain("jaegertracing/all-in-one");
		expect(text).toContain("otel/opentelemetry-collector-contrib");
		expect(text).toContain("prom/prometheus");
		expect(text).toContain("16686:16686");
		expect(text).toContain("4318:4318");
		expect(text).toContain("9090:9090");
	});
});
