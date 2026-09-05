import crypto from 'crypto';

export class SecurityGateway {
  /**
   * Удаляет HTML-теги и опасные SQL-ключевые слова
   */
  public static sanitizeInput(input: string): string {
    if (!input || typeof input !== 'string') return '';
    let sanitized = input.replace(/<[^>]*>?/gm, '');
    sanitized = sanitized.replace(/\b(DROP|DELETE|TRUNCATE|ALTER|INTO|UPDATE)\b\s+table/gi, '');
    sanitized = sanitized.replace(/--|\/\*|\*\/|;/g, '');
    return sanitized.trim();
  }

  /**
   * Маскирует PII (email, телефоны, IP-адреса)
   */
  public static maskPII(text: string): string {
    if (!text || typeof text !== 'string') return '';
    let masked = text;
    // Mask emails
    masked = masked.replace(/([a-zA-Z0-9_\-\.]+)@([a-zA-Z0-9_\-\.]+)\.([a-zA-Z]{2,5})/g, (match, user, domain, ext) => {
      const u = user.length > 2 ? user[0] + '***' + user[user.length - 1] : '***';
      return `${u}@${domain}.${ext}`;
    });
    // Mask phone numbers
    masked = masked.replace(/(?:\+?\d{1,3}[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{2}[-.\s]?\d{2}/g, '+X-XXX-XXX-XX-XX');
    // Mask IPv4
    masked = masked.replace(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, (ip) => {
      const parts = ip.split('.');
      return `${parts[0]}.${parts[1]}.*.*`;
    });
    return masked;
  }

  /**
   * Генерация SHA256 хеша через crypto
   */
  public static generateHash(data: string, salt: string = ''): string {
    return crypto.createHash('sha256').update(data + salt).digest('hex');
  }

  // ==========================================
  // 18+ Контроль доступа (ФЗ-436)
  // ==========================================
  private static pendingAdultQuestions: Map<string, { question: string; timestamp: number }> = new Map();

  private static adultPatterns: RegExp[] = [
    /\b(?:эротик\w*|эротич\w*)\b/i,
    /\b(?:сексолог\w*|сексопатол\w*|сексуал\w*)\b/i,
    /\b(?:секс|сексом|секса|сексу|сексе|сексах)\b/i,
    /\b(?:интим|интимн\w*)\b/i,
    /\b(?:порно\w*|порнух\w*|хентай|hentai|porn\w*)\b/i,
    /\b(?:камасутр\w*|оргазм\w*|эрекци\w*|мастурб\w*|онаниз\w*|фетиш\w*|бдсм|bdsm|кунилингус\w*|минет\w*|коитус|эякуляц\w*|эрогенн\w*)\b/i,
    /\b(?:оральный\s+секс\w*|анальный\s+секс\w*|половой\s+акт\w*|половые\s+акты|половым\s+актом|половая\s+жизнь|половую\s+жизнь|половой\s+жизни)\b/i,
    /\b(?:половой\s+член\w*|половые\s+органы|половых\s+органов|пенис\w*|вагин\w*|влагалищ\w*|клитор\w*)\b/i,
    /\b(?:возбудить\s+(?:девушку|женщину|парня|мужчину)|предварительн\w*\s+ласк\w*)\b/i
  ];

  /**
   * Проверка текста на взрослую тематику 18+ (эротика, сексология, интим)
   */
  public static isAdultContent(text: string): boolean {
    if (!text || typeof text !== 'string') return false;
    const trimmed = text.trim();
    return this.adultPatterns.some(pattern => pattern.test(trimmed));
  }

  public static setPendingAdultQuestion(chatId: string | number, question: string): void {
    const cleanId = String(chatId).replace(/^[a-z_]+/, '').trim();
    this.pendingAdultQuestions.set(cleanId, { question, timestamp: Date.now() });
  }

  public static getPendingAdultQuestion(chatId: string | number): string | null {
    const cleanId = String(chatId).replace(/^[a-z_]+/, '').trim();
    const item = this.pendingAdultQuestions.get(cleanId);
    if (!item) return null;
    // Ограничение по времени 1 час
    if (Date.now() - item.timestamp > 3600 * 1000) {
      this.pendingAdultQuestions.delete(cleanId);
      return null;
    }
    return item.question;
  }

  public static clearPendingAdultQuestion(chatId: string | number): void {
    const cleanId = String(chatId).replace(/^[a-z_]+/, '').trim();
    this.pendingAdultQuestions.delete(cleanId);
  }

  public static hasPendingAdultQuestion(chatId: string | number): boolean {
    return Boolean(this.getPendingAdultQuestion(chatId));
  }
}

export const ADULT_CONFIRM_TEXT = "Эта тема — 18+. Подтверди, что тебе исполнилось 18 лет.";

export const ADULT_CONFIRM_EXTRA = {
  attachments: [
    {
      type: 'inline_keyboard',
      payload: {
        buttons: [
          [
            { type: 'callback', text: '✅ Да, мне 18', payload: 'adult_confirm_yes', callback_data: 'adult_confirm_yes' },
            { type: 'callback', text: '❌ Нет', payload: 'adult_confirm_no', callback_data: 'adult_confirm_no' }
          ]
        ]
      }
    }
  ]
};
