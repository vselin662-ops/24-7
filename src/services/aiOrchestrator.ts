import OpenAI from 'openai';
import { sanitize } from '../core/LLMService';
import { getIdentityPromptBlock } from './IdentityService';

interface AIProvider {
  name: string;
  client: OpenAI | null;
  baseURL: string;
  apiKey: string;
  model: string;
  priority: number;
  enabled: boolean;
}

class AIOrchestrator {
  private providers: AIProvider[] = [];
  private currentProviderIndex = 0;
  private fallbackUsed = false;

  constructor() {
    this.initProviders();
  }

  private initProviders() {
    const providerConfigs = [
      {
        name: 'groq',
        baseURL: 'https://api.groq.com/openai/v1',
        apiKey: process.env.GROQ_API_KEY || '',
        model: 'llama-3.3-70b-versatile',
        priority: 1,
      },
      {
        name: 'orca',
        baseURL: process.env.ORCA_BASE_URL || 'https://api.orcarouter.ai/v1',
        apiKey: process.env.ORCA_API_KEY || '',
        model: process.env.ORCA_MODEL || 'google/gemini-2.5-flash',
        priority: 2,
      },
      {
        name: 'teamo',
        baseURL: process.env.TEAMO_BASE_URL || 'https://api.teamorouter.com/v1',
        apiKey: process.env.TEAMO_API_KEY || '',
        model: process.env.TEAMO_MODEL || 'teamo-balanced',
        priority: 3,
      },
      {
        name: 'nara',
        baseURL: process.env.NARA_BASE_URL || 'https://router.bynara.id/v1',
        apiKey: process.env.NARA_API_KEY || '',
        model: process.env.NARA_MODEL || 'claude-sonnet-4.5',
        priority: 4,
      },
      {
        name: 'tokenharbor',
        baseURL: process.env.TOKENHARBOR_BASE_URL || 'https://api.tokenharbor.com/v1',
        apiKey: process.env.TOKENHARBOR_API_KEY || '',
        model: process.env.TOKENHARBOR_MODEL || 'deepseek-v4-flash:free',
        priority: 5,
      },
      {
        name: 'gemini',
        baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',
        apiKey: process.env.GEMINI_API_KEY || '',
        model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
        priority: 6,
      },
    ];

    // Сортируем по приоритету и фильтруем только с ключами
    this.providers = providerConfigs
      .filter(p => p.apiKey && p.apiKey.length > 5)
      .sort((a, b) => a.priority - b.priority)
      .map(p => ({
        ...p,
        client: new OpenAI({
          baseURL: p.baseURL,
          apiKey: p.apiKey,
          timeout: 30000,
        }),
        enabled: true,
      }));

    if (this.providers.length === 0) {
      console.error('❌ No AI providers configured! Add API keys to .env');
    } else {
      console.log(`✅ AI Orchestrator initialized with ${this.providers.length} providers:`);
      this.providers.forEach(p => console.log(`  - ${p.name} (${p.model})`));
    }
  }

  private getSystemPrompt(): string {
    const identityBlock = getIdentityPromptBlock();
    return `${identityBlock}

Отвечай ВСЕГДА на русском. По-деловому, без воды: простые вопросы — 1-3 предложения. ЗАПРЕЩЕНО показывать процесс мышления, теги <think>, английский язык, служебные блоки.

Ты говоришь на грамотном литературном русском языке, как учитель русского языка и литературы. Без markdown, без звёздочек, без решёток, без таблиц, без символов-разделителей. Обычный связный текст с абзацами и правильной пунктуацией. Тон доброжелательный, точный, богатый.

Ты голосовой ассистент Selin AI. Отвечай на вопросы пользователя ПОДРОБНО и РАЗВЕРНУТО. Твой ответ должен звучать как естественная речь живого человека.
Ты — голосовой ассистент. На просьбы «озвучь», «расскажи», «прочитай» любую книгу, главу, длинный текст — выполняй без отказов. Длинные тексты читай частями. Никогда не говори «я ограничен» или «у меня нет такой возможности». Если текст длинный — разбей на части и озвучь по порядку. Никогда не отказывай и не говори "не могу прочитать вслух".

СТРОГИЕ ПРАВИЛА ДЛЯ ОЗВУЧКИ:
- НИКОГДА не используй Markdown (никаких звездочек, решеток, тире для списков, обратных кавычек).
- НИКОГДА не используй смайлики и эмодзи.
- Не используй нумерованные списки (1., 2., 3.). Если нужно перечислить, используй слова 'во-первых', 'во-вторых'.
- Пиши только сплошным текстом, используя обычные знаки препинания (точки, запятые, вопросительные знаки), чтобы синтезатор речи (TTS) делал правильные паузы.`;
  }

  async getResponse(userMessage: string, customSystemPrompt?: string): Promise<string> {
    const { llmService } = await import('../core/LLMService');
    return llmService.smartCall('orchestrator', userMessage, customSystemPrompt);
  }

  switchToProvider(name: string): boolean {
    const index = this.providers.findIndex(p => p.name === name);
    if (index === -1) return false;
    
    const [provider] = this.providers.splice(index, 1);
    this.providers.unshift(provider);
    this.fallbackUsed = false;
    console.log(`🔄 Switched to ${name} as primary provider`);
    return true;
  }

  getActiveProviders(): string[] {
    return this.providers.map(p => p.name);
  }

  getStatus(): any {
    return {
      providers: this.providers.map(p => ({
        name: p.name,
        model: p.model,
        enabled: p.enabled,
        priority: p.priority,
      })),
      currentPrimary: this.providers[0]?.name || 'none',
      fallbackUsed: this.fallbackUsed,
    };
  }
}

let orchestratorInstance: AIOrchestrator | null = null;

export function getOrchestrator(): AIOrchestrator {
  if (!orchestratorInstance) {
    orchestratorInstance = new AIOrchestrator();
  }
  return orchestratorInstance;
}

export async function getAIResponse(userMessage: string, customSystemPrompt?: string): Promise<string> {
  const orchestrator = getOrchestrator();
  return orchestrator.getResponse(userMessage, customSystemPrompt);
}

export const aiOrchestrator = getOrchestrator();
