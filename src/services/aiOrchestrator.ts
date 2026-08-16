import OpenAI from 'openai';

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
        model: process.env.ORCA_MODEL || 'openai/gpt-4o-mini',
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
        model: 'gemini-2.5-flash',
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
    return `Ты — Selin AI, голосовой ассистент в MAX Messenger.
Отвечай кратко (1-3 предложения), естественно, без markdown и эмодзи.
Твой ответ будет озвучен голосом.`;
  }

  async getResponse(userMessage: string): Promise<string> {
    if (this.providers.length === 0) {
      return 'Нет доступных AI-провайдеров. Проверь настройки API.';
    }

    // Если фолбэк уже использован, начинаем со второго провайдера
    const startIndex = this.fallbackUsed ? 1 : 0;
    const errors: string[] = [];

    for (let i = startIndex; i < this.providers.length; i++) {
      const provider = this.providers[i];
      if (!provider.enabled) continue;

      try {
        console.log(`🔄 Trying ${provider.name} (${provider.model})...`);
        
        const completion = await provider.client!.chat.completions.create({
          model: provider.model,
          messages: [
            { role: 'system', content: this.getSystemPrompt() },
            { role: 'user', content: userMessage }
          ],
          temperature: 0.7,
          max_tokens: 150,
        });

        const response = completion.choices[0]?.message?.content || 'Извини, не понял.';
        console.log(`✅ ${provider.name} responded successfully`);
        
        if (i === 0) {
          this.fallbackUsed = false;
        }
        
        return response;
      } catch (error: any) {
        const errMsg = error?.message || 'Unknown error';
        console.warn(`❌ ${provider.name} failed: ${errMsg.slice(0, 80)}`);
        errors.push(`${provider.name}: ${errMsg.slice(0, 50)}`);
        
        if (i === 0) {
          this.fallbackUsed = true;
        }
      }
    }

    this.fallbackUsed = true;
    console.error('❌ All AI providers failed:', errors.join('; '));
    return 'Все AI-провайдеры временно недоступны. Попробуй позже.';
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

export async function getAIResponse(userMessage: string): Promise<string> {
  const orchestrator = getOrchestrator();
  return orchestrator.getResponse(userMessage);
}

export const aiOrchestrator = getOrchestrator();
