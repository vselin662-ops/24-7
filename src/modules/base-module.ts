import type { Intent } from '../core/intent-engine';
import type { Memory } from '../core/memory';

export interface ActionResult {
  text: string;
  data?: Record<string, unknown>;
}

export interface IntelligenceModule {
  name: string;
  processIntent(intent: Intent, memory: Memory): Promise<ActionResult>;
  getCapabilities(): string[];
}
