import { BaseAgent } from './BaseAgent';
import { Task, TaskType, AIResponse, AgentCapabilityType } from '../core/types';
import { LLMService, llmService } from '../core/LLMService';
import { flightService, FlightService, FlightDeal } from '../services/FlightService';

/**
 * Агент туризма и путешествий (TravelAgent).
 * 
 * Возможности:
 * - Поиск и сравнение авиабилетов через FlightService (Travelpayouts API + AI)
 * - Подбор отелей и расчет пакетных скидок
 * - Составление туристических маршрутов и рекомендаций
 * - Автоматический расчет экономии
 */
export class TravelAgent extends BaseAgent {
  public readonly name = 'TravelAgent';
  public readonly description = 'Поиск авиабилетов, отелей, туристических маршрутов и расчет комплексных скидок.';
  private flightService: FlightService;

  constructor(llm: LLMService = llmService, flights: FlightService = flightService) {
    super('TravelAgent', 'Поиск авиабилетов, отелей, туристических маршрутов и расчет комплексных скидок.', llm);
    this.flightService = flights;
    this.capabilities = [
      {
        name: 'flight_and_hotel_search',
        description: 'Поиск авиабилетов и гостиниц со скидками',
        supportedTaskTypes: [TaskType.TRAVEL, TaskType.ORDER],
        capabilities: [AgentCapabilityType.EXTERNAL_API_CALL, AgentCapabilityType.TEXT_GENERATION, AgentCapabilityType.GEOLOCATION_SERVICES],
        supportsVoice: true,
        supportsCamera: false,
        supportsLocation: true
      }
    ];
  }

  public canHandle(task: Task): boolean {
    if (task.type === TaskType.TRAVEL) return true;
    const msg = (task.payload?.message || '').toLowerCase();
    return msg.includes('билет') ||
           msg.includes('рейс') ||
           msg.includes('самолет') ||
           msg.includes('авиабилет') ||
           msg.includes('отель') ||
           msg.includes('гостиниц') ||
           msg.includes('дубай') ||
           msg.includes('стамбул') ||
           msg.includes('сочи') ||
           msg.includes('отпуск') ||
           msg.includes('путешеств') ||
           msg.includes('тур');
  }

  public async execute(task: Task): Promise<AIResponse> {
    this.setStatus('busy');
    const userMessage = task.payload?.message || '';

    try {
      // 1. Поиск направления в запросе
      let destination = 'Дубай';
      const lower = userMessage.toLowerCase();
      if (lower.includes('стамбул') || lower.includes('турци')) destination = 'Стамбул';
      else if (lower.includes('сочи')) destination = 'Сочи';
      else if (lower.includes('ташкент')) destination = 'Ташкент';
      else if (lower.includes('ереван')) destination = 'Ереван';

      // 2. Вызов FlightService
      const flights: FlightDeal[] = await this.flightService.searchFlights({ destination });
      const bestFlight = flights[0];
      const hotels = await this.flightService.searchHotels(destination);
      const bestHotel = hotels[0];

      // 3. Расчет скидки на турпакет (Перелет + Отель на 3 ночи)
      const packageCalc = this.flightService.calculatePackageDiscount(bestFlight, bestHotel, 3);

      // 4. Генерация через LLM
      const systemPrompt = `Ты — TravelAgent в мультиагентной платформе Selin AI 2.0. Ты опытный и внимательный тревел-консьерж. Твоя цель — презентовать лучшие варианты перелета и проживания с акцентом на выгоду и комфорт. Используй эмодзи, маркированные списки и четкие цены.`;

      const discountPercent = bestFlight.feeBreakdown?.discountPercent || 5;
      const basePrice = bestFlight.feeBreakdown?.basePrice || bestFlight.priceRub;
      const finalPrice = bestFlight.feeBreakdown?.finalPrice || bestFlight.priceRub;

      const prompt = `Запрос пользователя: "${userMessage}".
Найденный перелет:
- Рейс: ${bestFlight.airline} (${bestFlight.flightNumber}) ${bestFlight.origin} -> ${bestFlight.destination}
- Время: ${bestFlight.departureTime} - ${bestFlight.arrivalTime} (${bestFlight.duration}, без пересадок)
- Цена билета: ${finalPrice} ₽ (Скидка ${discountPercent}%, базовая цена ${basePrice} ₽)

Рекомендованный отель:
- ${bestHotel.name} (${bestHotel.stars}★, рейтинг ${bestHotel.rating})
- Стоимость: ${bestHotel.pricePerNightRub} ₽/ночь

Пакетное предложение (Перелет + 3 ночи):
- Цена без скидки: ${packageCalc.totalWithoutDiscount} ₽
- Пакетная скидка: ${packageCalc.packageDiscountPercent}%
- Итоговая цена со скидкой: ${packageCalc.finalPrice} ₽
- Экономия: ${packageCalc.discountSavings} ₽!

Сформируй яркое и структурированное предложение для клиента.`;

      const aiText = await this.callLLM(prompt, systemPrompt);

      this.setStatus('idle');
      return {
        text: aiText,
        confidence: 0.95,
        locationData: {
          destination: bestFlight.destination,
          coordinates: { lat: 25.2048, lng: 55.2708 }
        },
        actions: [
          {
            id: `action_book_flight_${Date.now()}`,
            type: 'book_travel_package',
            payload: {
              flightId: bestFlight.id,
              hotelId: bestHotel.id,
              totalRub: packageCalc.finalPrice
            },
            description: `Забронировать тур в ${bestFlight.destination} за ${packageCalc.finalPrice} ₽`
          }
        ],
        metadata: {
          flightsFound: flights.length,
          bestFlight,
          packageCalc
        }
      };
    } catch (err: any) {
      return this.handleError(`Ошибка при поиске авиабилетов: ${err?.message || err}`, err);
    }
  }
}
