import { sqliteDb } from '../../db';

export interface UserModeRecord {
  tenant_id: string;
  mode: string;
  mode_data: any;
  updated_at: number;
}

/**
 * Репозиторий управления текущим режимом диалога пользователя.
 */
class UserModeRepository {
  /**
   * Устанавливает текущий режим работы пользователя.
   *
   * @param tenantId - Идентификатор пользователя
   * @param mode - Название режима ('language', 'business', 'general')
   * @param data - Дополнительный контекст
   */
  async setMode(tenantId: string, mode: string, data: Record<string, any> = {}): Promise<void> {
    if (!sqliteDb) return;
    const stmt = sqliteDb.prepare(`
      INSERT INTO user_mode (tenant_id, mode, mode_data, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(tenant_id) DO UPDATE SET
        mode = excluded.mode,
        mode_data = excluded.mode_data,
        updated_at = excluded.updated_at
    `);
    stmt.run(tenantId, mode, JSON.stringify(data), Date.now());
  }

  /**
   * Возвращает текущую запись о режиме пользователя.
   *
   * @param tenantId - Идентификатор пользователя
   */
  async getMode(tenantId: string): Promise<UserModeRecord | null> {
    if (!sqliteDb) return null;
    const stmt = sqliteDb.prepare(`SELECT * FROM user_mode WHERE tenant_id = ?`);
    const row = stmt.get(tenantId);
    if (!row) return null;
    let modeData = {};
    try {
      modeData = row.mode_data ? JSON.parse(row.mode_data) : {};
    } catch (e) {
      modeData = {};
    }
    return {
      tenant_id: row.tenant_id,
      mode: row.mode,
      mode_data: modeData,
      updated_at: Number(row.updated_at) || Date.now(),
    };
  }

  /**
   * Возвращает контекстные данные режима пользователя.
   *
   * @param tenantId - Идентификатор пользователя
   */
  async getModeData(tenantId: string): Promise<Record<string, any> | null> {
    const record = await this.getMode(tenantId);
    return record?.mode_data || null;
  }
}

export const userModeRepository = new UserModeRepository();
