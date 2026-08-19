import { BaseAgent } from './BaseAgent';
import { Task, TaskType, AIResponse, AgentCapabilityType } from '../core/types';
import { LLMService, llmService } from '../core/LLMService';

/**
 * Агент генерации медиа и текстового контента (ContentAgent).
 * 
 * Возможности:
 * - Написание вовлекающих постов для Telegram, соцсетей и блогов
 * - Разработка сценариев для Reels, YouTube Shorts и видео
 * - Генерация цепляющих заголовков (Hook), призывов к действию (CTA) и контент-планов
 */
export class ContentAgent extends BaseAgent {
  public readonly name = 'ContentAgent';
  public readonly description = 'Генерация постов, вирусных сценариев, статей, контент-планов и маркетинговых текстов.';

  constructor(llm: LLMService = llmService) {
    super('ContentAgent', 'Генерация постов, вирусных сценариев, статей, контент-планов и маркетинговых текстов.', llm);
    this.capabilities = [
      {
        name: 'creative_copywriting',
        description: 'Копирайтинг, сценарии и контент-маркетинг',
        supportedTaskTypes: [TaskType.CONTENT, TaskType.MARKETING],
        capabilities: [AgentCapabilityType.TEXT_GENERATION],
        supportsVoice: true,
        supportsCamera: false,
        supportsLocation: false
      }
    ];
  }

  public canHandle(task: Task): boolean {
    if (task.type === TaskType.CONTENT) return true;
    const msg = (task.payload?.message || '').toLowerCase();
    return msg.includes('пост') ||
           msg.includes('сценарий') ||
           msg.includes('контент') ||
           msg.includes('рилс') ||
           msg.includes('reels') ||
           msg.includes('shorts') ||
           msg.includes('статья') ||
           msg.includes('копирайтинг') ||
           msg.includes('заголовок') ||
           msg.includes('текст для канала');
  }

  public async execute(task: Task): Promise<AIResponse> {
    this.setStatus('busy');
    const userMessage = task.payload?.message || '';

    try {
      const isScript = userMessage.toLowerCase().includes('сценарий') || userMessage.toLowerCase().includes('рилс') || userMessage.toLowerCase().includes('reels');

      const systemPrompt = isScript
        ? `Ты — топовый сценарист коротких видео (Reels / TikTok / YouTube Shorts) в Selin AI 2.0.
Твоя цель — создать цепляющий сценарий с высоким retention:
- 🪝 Хук (первые 3 секунды): яркое визуальное и речевое действие
- 🎬 Таймкоды и визуальный ряд (что показывать в кадре)
- 🗣️ Реплики диктора/актера
- 🎯 Сильный CTA (Call to Action в конце)`
        : `Ты — экспертный контент-криейтор и копирайтер в Selin AI 2.0.
Создай вовлекающий, эмоциональный и легко читаемый пост.
Используй:
- Мощный хук-заголовок
- Разделение на абзацы и списки
- Уместные эмодзи
- Конкретную пользу и яркий вывод / вопрос в аудиторию.`;

      const prompt = `Запрос пользователя: "${userMessage}".
Создай качественный контент высшего уровня.`;

      const aiText = await this.callLLM(prompt, systemPrompt);

      this.setStatus('idle');
      return {
        text: aiText,
        confidence: 0.95,
        suggestedReplies: [
          'Сделай 3 варианта цепляющих заголовков',
          'Адаптируй этот текст под формат Telegram',
          'Напиши сценарий для Reels по этой теме'
        ],
        metadata: {
          contentType: isScript ? 'video_script' : 'post',
          charCount: aiText.length
        }
      };
    } catch (err: any) {
      return this.handleError(`Ошибка при создании контента: ${err?.message || err}`, err);
    }
  }
}
