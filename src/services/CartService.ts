import { llmService } from "../core/LLMService";
import { logger } from "../logger";
import { UserProfile } from "./ProfileService";

const BASE_PRICES: Record<string, { price: number; unit: string }> = {
  'свёкла': { price: 40, unit: 'кг' },
  'свекла': { price: 40, unit: 'кг' },
  'капуста': { price: 50, unit: 'кг' },
  'картофель': { price: 35, unit: 'кг' },
  'картошка': { price: 35, unit: 'кг' },
  'морковь': { price: 45, unit: 'кг' },
  'морковка': { price: 45, unit: 'кг' },
  'лук': { price: 40, unit: 'кг' },
  'говядина': { price: 650, unit: 'кг' },
  'курица': { price: 350, unit: 'кг' },
  'куриное филе': { price: 380, unit: 'кг' },
  'томатная паста': { price: 90, unit: 'шт' },
  'сметана': { price: 80, unit: 'шт' },
  'хлеб': { price: 45, unit: 'шт' },
  'молоко': { price: 75, unit: 'шт' },
  'яйца': { price: 120, unit: '10шт' },
  'сыр': { price: 250, unit: 'шт' },
  'масло сливочное': { price: 180, unit: 'шт' },
  'масло растительное': { price: 110, unit: 'шт' },
  'сахар': { price: 60, unit: 'кг' },
  'соль': { price: 20, unit: 'кг' },
  'рис': { price: 90, unit: 'кг' },
  'гречка': { price: 80, unit: 'кг' },
  'макароны': { price: 70, unit: 'шт' },
  'мука': { price: 50, unit: 'кг' },
  'свинина': { price: 450, unit: 'кг' },
  'фарш': { price: 400, unit: 'кг' },
  'колбаса': { price: 300, unit: 'шт' },
  'сосиски': { price: 250, unit: 'шт' },
  'чеснок': { price: 20, unit: 'шт' },
  'укроп': { price: 30, unit: 'шт' },
  'петрушка': { price: 30, unit: 'шт' },
  'перец': { price: 150, unit: 'кг' },
  'помидоры': { price: 200, unit: 'кг' },
  'томаты': { price: 200, unit: 'кг' },
  'огурцы': { price: 150, unit: 'кг' },
  'яблоки': { price: 100, unit: 'кг' },
  'бананы': { price: 140, unit: 'кг' },
  'лимон': { price: 30, unit: 'шт' },
  'грибы': { price: 180, unit: 'шт' },
  'вода': { price: 40, unit: 'шт' },
  'сок': { price: 100, unit: 'шт' },
  'чай': { price: 120, unit: 'шт' },
  'кофе': { price: 250, unit: 'шт' }
};

interface CartItem {
  name: string;
  qty: string | number;
}

interface LLMCartResponse {
  items: CartItem[];
  note?: string;
}

export async function buildCart(message: string, profile: UserProfile | null): Promise<{ text: string; extra: any }> {
  const profileStr = profile ? JSON.stringify(profile) : 'нет данных';

  const systemPrompt = `Составь список продуктов для запроса пользователя с учётом его профиля: ${profileStr}.
Учитывай число людей (family_size) и ограничения в еде (diet_restrictions). Если есть ограничение (например, без свинины), ЗАМЕНИ запрещенные продукты на разрешенные альтернативы (например, свинину на говядину или курицу).
Верни СТРОГО JSON следующей структуры:
{
  "items": [
    { "name": "название продукта на русском", "qty": "количество (например, '1 кг', '0.5 кг', '1 шт', '10 шт')" }
  ],
  "note": "краткое примечание с учетом замен и ограничений"
}
Цены в JSON НЕ выдумывай. Только список предметов и их количество. Возвращай исключительно чистый JSON.`;

  try {
    const rawRes = await llmService.smartCall("cart_builder_service", message, systemPrompt);
    const cleaned = rawRes.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
    const parsed = JSON.parse(cleaned) as LLMCartResponse;

    let totalSum = 0;
    const lines: string[] = [];

    for (const item of parsed.items) {
      const lowerName = item.name.toLowerCase().trim();
      let matchedPriceObj = BASE_PRICES[lowerName];

      if (!matchedPriceObj) {
        // Поиск по подстроке
        const key = Object.keys(BASE_PRICES).find(k => lowerName.includes(k) || k.includes(lowerName));
        if (key) {
          matchedPriceObj = BASE_PRICES[key];
        }
      }

      // Определение числового коэффициента количества
      let factor = 1;
      const qtyStr = String(item.qty).toLowerCase();
      const numMatch = qtyStr.match(/(\d+(?:[.,]\d+)?)/);
      if (numMatch) {
        factor = parseFloat(numMatch[1].replace(',', '.'));
      }

      // Корректировка граммов на килограммы
      if (qtyStr.includes('г') && !qtyStr.includes('кг')) {
        factor = factor / 1000;
      }

      const unitPrice = matchedPriceObj ? matchedPriceObj.price : 100; // По умолчанию 100 руб
      const itemCost = Math.round(unitPrice * factor);
      totalSum += itemCost;

      lines.push(`- ${item.name} (${item.qty}) — ${itemCost}₽`);
    }

    let responseText = `🛒 **Список продуктов по вашему запросу**:\n\n${lines.join('\n')}\n\n`;
    responseText += `📊 **Итоговая смета**: ≈ ${totalSum}₽ (смета приблизительная)\n`;
    if (parsed.note) {
      responseText += `📝 *Примечание*: ${parsed.note}\n`;
    }

    const extra = {
      attachments: [
        {
          type: 'inline_keyboard',
          payload: {
            buttons: [
              [
                { text: '🏪 Пятёрочка', url: 'https://5ka.ru' },
                { text: '🥑 ВкусВилл', url: 'https://vkusvill.ru' },
                { text: '🛒 Перекрёсток', url: 'https://www.perekrestok.ru' }
              ]
            ]
          }
        }
      ]
    };

    return { text: responseText, extra };
  } catch (err) {
    logger.error("❌ [CartService] Error building cart:", err);
    return {
      text: "Извините, не удалось собрать корзину продуктов. Пожалуйста, попробуйте еще раз.",
      extra: null
    };
  }
}
