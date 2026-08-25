interface MetricLabels {
  [key: string]: string;
}

interface CounterMetric {
  type: "counter";
  help: string;
  values: Map<string, number>;
}

interface GaugeMetric {
  type: "gauge";
  help: string;
  values: Map<string, number>;
}

interface HistogramMetric {
  type: "histogram";
  help: string;
  buckets: number[];
  counts: Map<string, Map<number, number>>; // key -> (bucket_upper_bound -> count)
  sums: Map<string, number>;
  totalCounts: Map<string, number>;
}

type MetricStore = CounterMetric | GaugeMetric | HistogramMetric;

class PrometheusMetricsRegistry {
  private metrics: Map<string, MetricStore> = new Map();
  private activeTenants: Map<string, number> = new Map(); // tenantId -> lastActiveTimestamp

  constructor() {
    this.registerCounter("http_requests_total", "Total HTTP requests count");
    this.registerHistogram("http_request_duration_seconds", "HTTP request latency in seconds", [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]);
    this.registerCounter("llm_calls_total", "Total LLM API calls");
    this.registerHistogram("llm_call_duration_seconds", "LLM API call duration in seconds", [0.1, 0.25, 0.5, 1, 2.5, 5, 10, 20, 30]);
    this.registerCounter("tts_syntheses_total", "Total TTS synthesis requests");
    this.registerGauge("circuit_breaker_state", "Circuit breaker state (0=closed, 1=open, 2=half_open)");
    this.registerGauge("active_tenants", "Number of active tenants in the last 1 hour");
    this.registerCounter("sqlite_operations_total", "Total SQLite database operations");
    this.registerCounter("rate_limit_hits_total", "Total rate limiter trigger hits");
  }

  private registerCounter(name: string, help: string) {
    this.metrics.set(name, {
      type: "counter",
      help,
      values: new Map(),
    });
  }

  private registerGauge(name: string, help: string) {
    this.metrics.set(name, {
      type: "gauge",
      help,
      values: new Map(),
    });
  }

  private registerHistogram(name: string, help: string, buckets: number[]) {
    this.metrics.set(name, {
      type: "histogram",
      help,
      buckets: [...buckets].sort((a, b) => a - b),
      counts: new Map(),
      sums: new Map(),
      totalCounts: new Map(),
    });
  }

  private serializeLabels(labels: MetricLabels = {}): string {
    const keys = Object.keys(labels).sort();
    if (keys.length === 0) return "";
    const str = keys.map((k) => `${k}="${labels[k]}"`).join(",");
    return `{${str}}`;
  }

  public incrementCounter(name: string, labels: MetricLabels = {}, value = 1) {
    const metric = this.metrics.get(name);
    if (!metric || metric.type !== "counter") return;

    const labelKey = this.serializeLabels(labels);
    const current = metric.values.get(labelKey) || 0;
    metric.values.set(labelKey, current + value);
  }

  public setGauge(name: string, value: number, labels: MetricLabels = {}) {
    const metric = this.metrics.get(name);
    if (!metric || metric.type !== "gauge") return;

    const labelKey = this.serializeLabels(labels);
    metric.values.set(labelKey, value);
  }

  public observeHistogram(name: string, value: number, labels: MetricLabels = {}) {
    const metric = this.metrics.get(name);
    if (!metric || metric.type !== "histogram") return;

    const labelKey = this.serializeLabels(labels);

    if (!metric.counts.has(labelKey)) {
      metric.counts.set(labelKey, new Map());
      metric.sums.set(labelKey, 0);
      metric.totalCounts.set(labelKey, 0);
    }

    const bucketMap = metric.counts.get(labelKey)!;
    for (const b of metric.buckets) {
      if (value <= b) {
        bucketMap.set(b, (bucketMap.get(b) || 0) + 1);
      }
    }

    metric.sums.set(labelKey, (metric.sums.get(labelKey) || 0) + value);
    metric.totalCounts.set(labelKey, (metric.totalCounts.get(labelKey) || 0) + 1);
  }

  public recordTenantActivity(tenantId: string) {
    if (!tenantId || tenantId === "default") return;
    this.activeTenants.set(tenantId, Date.now());
  }

  private updateActiveTenantsGauge() {
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    let count = 0;
    for (const [id, lastActive] of this.activeTenants.entries()) {
      if (lastActive >= oneHourAgo) {
        count++;
      } else {
        this.activeTenants.delete(id);
      }
    }
    this.setGauge("active_tenants", count);
  }

  public getContentType(): string {
    return "text/plain; version=0.0.4; charset=utf-8";
  }

  public getMetrics(): string {
    this.updateActiveTenantsGauge();
    const lines: string[] = [];

    for (const [name, metric] of this.metrics.entries()) {
      lines.push(`# HELP ${name} ${metric.help}`);
      lines.push(`# TYPE ${name} ${metric.type}`);

      if (metric.type === "counter" || metric.type === "gauge") {
        if (metric.values.size === 0) {
          lines.push(`${name} 0`);
        } else {
          for (const [labelStr, val] of metric.values.entries()) {
            lines.push(`${name}${labelStr} ${val}`);
          }
        }
      } else if (metric.type === "histogram") {
        if (metric.totalCounts.size === 0) {
          lines.push(`${name}_count 0`);
          lines.push(`${name}_sum 0`);
        } else {
          for (const [labelStr] of metric.totalCounts.entries()) {
            const bucketMap = metric.counts.get(labelStr)!;
            const total = metric.totalCounts.get(labelStr)!;
            const sum = metric.sums.get(labelStr)!;

            let baseLabelsStr = labelStr ? labelStr.slice(1, -1) : ""; // remove { and }
            if (baseLabelsStr.length > 0) baseLabelsStr += ",";

            for (const b of metric.buckets) {
              const count = bucketMap.get(b) || 0;
              lines.push(`${name}_bucket{${baseLabelsStr}le="${b}"} ${count}`);
            }
            lines.push(`${name}_bucket{${baseLabelsStr}le="+Inf"} ${total}`);
            lines.push(`${name}_sum${labelStr} ${sum}`);
            lines.push(`${name}_count${labelStr} ${total}`);
          }
        }
      }
      lines.push("");
    }

    return lines.join("\n");
  }
}

export const metrics = new PrometheusMetricsRegistry();
