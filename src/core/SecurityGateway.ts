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
}
