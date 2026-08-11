import crypto from 'crypto';
import { sqliteDb } from '../../db';
import { geminiService } from '../services/gemini.service';
import { logger } from '../logger';

export interface PlanStep {
  order: number;
  action: string;
  description: string;
  status: 'pending' | 'done' | 'skipped';
  result?: string;
}

export interface Plan {
  id: string;
  tenant_id: string;
  goal: string;
  steps: PlanStep[];
  status: 'active' | 'completed' | 'paused';
  progress_percent: number;
  created_at: number;
  updated_at?: number;
}

/**
 * Планировщик действий.
 * Строит цепочки действий для сложных задач.
 */
export class Planner {
  /**
   * Создаёт поэтапный план достижения цели.
   */
  async createPlan(goal: string, tenantId: string): Promise<Plan> {
    const prompt = `Ты — модуль планирования автономного интеллекта Selin AI.
Составь пошаговый план для выполнения цели.

Цель: "${goal}"

Верни СТРОГО JSON без markdown:
{
  "steps": [
    {
      "order": 1,
      "action": "краткое название действия",
      "description": "подробности шага"
    }
  ]
}`;

    let steps: PlanStep[] = [];
    try {
      const response = await geminiService.generate(prompt, { temperature: 0.3 });
      const cleaned = response.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
      const parsed = JSON.parse(cleaned);

      if (Array.isArray(parsed.steps)) {
        steps = parsed.steps.map((s: any, idx: number) => ({
          order: s.order || idx + 1,
          action: s.action || `Шаг ${idx + 1}`,
          description: s.description || '',
          status: 'pending',
        }));
      }
    } catch (err) {
      logger.error('Failed to generate plan via Gemini, creating default single step', { error: err });
      steps = [
        {
          order: 1,
          action: 'Выполнение цели',
          description: goal,
          status: 'pending',
        },
      ];
    }

    const plan: Plan = {
      id: crypto.randomUUID(),
      tenant_id: tenantId,
      goal,
      steps,
      status: 'active',
      progress_percent: 0,
      created_at: Date.now(),
    };

    if (sqliteDb) {
      const stmt = sqliteDb.prepare(`
        INSERT INTO plans (id, tenant_id, goal, steps_json, status, progress_percent, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      stmt.run(
        plan.id,
        plan.tenant_id,
        plan.goal,
        JSON.stringify(plan.steps),
        plan.status,
        plan.progress_percent,
        plan.created_at
      );
    }

    return plan;
  }

  /**
   * Возвращает активный план пользователя.
   */
  async getActivePlan(tenantId: string): Promise<Plan | null> {
    if (!sqliteDb) return null;
    const stmt = sqliteDb.prepare(`SELECT * FROM plans WHERE tenant_id = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1`);
    const row = stmt.get(tenantId);
    if (!row) return null;

    let steps: PlanStep[] = [];
    try {
      steps = JSON.parse(row.steps_json);
    } catch {
      steps = [];
    }

    return {
      id: row.id,
      tenant_id: row.tenant_id,
      goal: row.goal,
      steps,
      status: row.status,
      progress_percent: Number(row.progress_percent) || 0,
      created_at: Number(row.created_at),
      updated_at: row.updated_at ? Number(row.updated_at) : undefined,
    };
  }
}

export const planner = new Planner();
