import { analyzeCoverageResilience } from "./resilience";
import type { ResilienceInput } from "./resilience";

self.onmessage = (event: MessageEvent<ResilienceInput>) => {
  try {
    self.postMessage({ ok: true, result: analyzeCoverageResilience(event.data) });
  } catch (error) {
    self.postMessage({
      ok: false,
      message: error instanceof Error ? error.message : String(error),
    });
  }
};

export {};
