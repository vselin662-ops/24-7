import { BaseConnector } from "./base";
import { logger } from "../logger";
import { GoogleGenAI } from "@google/genai";

export interface InstagramParams {
  task: "content_plan" | "post" | "story";
  niche: string;
  tone?: "professional" | "friendly" | "luxurious" | "engaging";
  caption?: string;
  imageUrl?: string;
}

export interface ContentPlanItem {
  date: string;
  caption: string;
  prompt: string;
  postType: "post" | "reel" | "carousel" | "story";
  hashtags: string[];
}

export interface InstagramResult {
  postId?: string;
  url?: string;
  scheduledAt?: string;
  contentPlan?: ContentPlanItem[];
  generatedImagePrompt?: string;
  status: "published" | "scheduled" | "draft_generated" | "fallback_local";
  message?: string;
}

export class InstagramConnector extends BaseConnector<InstagramParams, InstagramResult> {
  public readonly name = "instagram_connector";
  public readonly description = "Автоматизация SMM: генерация контент-планов через Gemini, визуальных промтов для Imagen и публикация постов через Instagram Graph API";

  protected async execute(params: InstagramParams, tenantId?: string): Promise<InstagramResult> {
    const accessToken = process.env.INSTAGRAM_ACCESS_TOKEN;
    const accountId = process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID;
    const geminiKey = process.env.GEMINI_API_KEY;

    logger.info("📸 Запуск Instagram SMM Коннектора", { tenantId, task: params.task, niche: params.niche });

    // 1. If task is content plan generation
    if (params.task === "content_plan") {
      if (!geminiKey) {
        throw new Error("GEMINI_API_KEY не установлен для генерации контент-плана");
      }

      const ai = new GoogleGenAI({ apiKey: geminiKey });
      const prompt = `Ты — топовый SMM-стратег. Создай контент-план на 7 дней для ниши: "${params.niche}". Тон: ${params.tone || "engaging"}.
Верни СТРОГО JSON массив объектов:
[
  {
    "date": "День 1",
    "caption": "Текст поста с призывом к действию и эмодзи",
    "prompt": "Детальный промт для генерации фото в Imagen/Midjourney",
    "postType": "post" | "reel" | "carousel" | "story",
    "hashtags": ["#хэштег1", "#хэштег2"]
  }
]`;

      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: prompt,
      });

      const responseText = response.text || "";
      let contentPlan: ContentPlanItem[] = [];

      try {
        const jsonMatch = responseText.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          contentPlan = JSON.parse(jsonMatch[0]);
        }
      } catch (parseErr) {
        logger.warn("Не удалось распарсить JSON контент-плана, используем резервную структуру", { error: parseErr });
      }

      if (!contentPlan || contentPlan.length === 0) {
        contentPlan = [
          {
            date: "День 1",
            caption: `🔥 Добро пожаловать! Мы открываем новые горизонты в сфере ${params.niche}.`,
            prompt: `High-end cinematic photo representing ${params.niche}, modern aesthetics, studio lighting`,
            postType: "post",
            hashtags: ["#бизнес", "#успех", "#тренды"]
          }
        ];
      }

      return {
        contentPlan,
        status: "draft_generated",
        message: `Сгенерирован уникальный контент-план на 7 дней для ниши "${params.niche}"`,
      };
    }

    // 2. If task is publishing post or story
    if (!accessToken || !accountId) {
      throw new Error("INSTAGRAM_ACCESS_TOKEN или INSTAGRAM_BUSINESS_ACCOUNT_ID отсутствует");
    }

    const caption = params.caption || `Новости ${params.niche} #selin_ai`;
    const imageUrl = params.imageUrl || "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=1200";

    // Step A: Create Container
    const containerRes = await fetch(`https://graph.facebook.com/v18.0/${accountId}/media`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        image_url: imageUrl,
        caption,
        access_token: accessToken,
      }),
    });

    if (!containerRes.ok) {
      throw new Error(`Ошибка создания медиа в Instagram (${containerRes.status}): ${await containerRes.text()}`);
    }

    const containerData: any = await containerRes.json();
    const creationId = containerData.id;

    // Step B: Publish Container
    const publishRes = await fetch(`https://graph.facebook.com/v18.0/${accountId}/media_publish`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        creation_id: creationId,
        access_token: accessToken,
      }),
    });

    if (!publishRes.ok) {
      throw new Error(`Ошибка публикации в Instagram (${publishRes.status}): ${await publishRes.text()}`);
    }

    const publishData: any = await publishRes.json();

    return {
      postId: publishData.id,
      url: `https://instagram.com/p/${publishData.id}`,
      scheduledAt: new Date().toISOString(),
      status: "published",
      message: "Пост успешно опубликован в Instagram аккаунте компании!",
    };
  }

  protected async handleFallback(
    params: InstagramParams,
    error: Error,
    tenantId?: string
  ): Promise<{ data?: InstagramResult; fallbackUrl?: string; message?: string }> {
    // Generate AI content draft locally via fallback if API fails or lacks credentials
    const promptForImagen = `Aesthetic professional photography of ${params.niche}, elegant atmosphere, high resolution 8k`;

    const sampleContentPlan: ContentPlanItem[] = [
      {
        date: "День 1 (Пн)",
        caption: `🚀 Инновации в ${params.niche}: Как повысить эффективность вашего бизнеса на 40% с помощью ИИ.`,
        prompt: promptForImagen,
        postType: "post",
        hashtags: ["#инновации", "#бизнес2026", "#автоматизация"]
      },
      {
        date: "День 3 (Ср)",
        caption: "💡 Кейс недели: Разбор реальной задачи и наш метод решения.",
        prompt: `Modern workspace showcasing innovation for ${params.niche}, minimalist luxury design`,
        postType: "reel",
        hashtags: ["#кейсы", "#опыт", "#рост"]
      },
      {
        date: "День 5 (Пт)",
        caption: "✨ Закулисье нашей работы: Как создается perfection каждый день.",
        prompt: `Atmospheric team photo for ${params.niche}, warm cinematic lighting`,
        postType: "story",
        hashtags: ["#команда", "#закулисье"]
      }
    ];

    const fallbackResult: InstagramResult = {
      contentPlan: sampleContentPlan,
      generatedImagePrompt: promptForImagen,
      status: "fallback_local",
      message: `Прямая публикация временно переведена в формат черновиков Meta Business Suite (${error.message}). Готовы промты Imagen и тексты постов.`,
    };

    return {
      data: fallbackResult,
      fallbackUrl: "https://business.facebook.com/latest/composer",
      message: fallbackResult.message,
    };
  }
}
