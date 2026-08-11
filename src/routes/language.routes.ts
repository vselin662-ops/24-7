import { Router } from 'express';
import { z } from 'zod';
import {
  startLearning,
  processMessage,
  startLesson,
  getProgress,
  switchLanguage,
} from '../modules/language/language.module';
import { SUPPORTED_LANGUAGES, type LanguageCode } from '../config/constants';

const router = Router();

const languageKeys = Object.keys(SUPPORTED_LANGUAGES) as [LanguageCode, ...LanguageCode[]];

const startSchema = z.object({
  language: z.enum(languageKeys),
  tenant_id: z.string().optional().default('default_user'),
});

const messageSchema = z.object({
  text: z.string().min(1),
  tenant_id: z.string().optional().default('default_user'),
  isVoice: z.boolean().optional().default(false),
});

const tenantSchema = z.object({
  tenant_id: z.string().optional().default('default_user'),
});

/**
 * POST /api/language/start - Начать изучение языка
 */
router.post('/start', async (req, res) => {
  try {
    const body = startSchema.parse(req.body);
    const response = await startLearning(body.tenant_id, body.language);
    res.json({ success: true, message: response });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message || 'Invalid parameters' });
  }
});

/**
 * POST /api/language/message - Обработать входящее сообщение
 */
router.post('/message', async (req, res) => {
  try {
    const body = messageSchema.parse(req.body);
    const response = await processMessage(body.tenant_id, body.text, body.isVoice);
    res.json({ success: true, message: response });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message || 'Invalid parameters' });
  }
});

/**
 * POST /api/language/lesson - Сгенерировать и начать новый урок
 */
router.post('/lesson', async (req, res) => {
  try {
    const body = tenantSchema.parse(req.body);
    const lessonResult = await startLesson(body.tenant_id);
    res.json({ success: true, data: lessonResult });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message || 'Failed to start lesson' });
  }
});

/**
 * GET /api/language/progress - Получить статистику прогресса
 */
router.get('/progress', async (req, res) => {
  try {
    const tenantId = (req.query.tenant_id as string) || 'default_user';
    const progressText = await getProgress(tenantId);
    res.json({ success: true, message: progressText });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message || 'Failed to fetch progress' });
  }
});

/**
 * POST /api/language/switch - Сменить изучаемый язык
 */
router.post('/switch', async (req, res) => {
  try {
    const body = startSchema.parse(req.body);
    const response = await switchLanguage(body.tenant_id, body.language);
    res.json({ success: true, message: response });
  } catch (err: any) {
    res.status(400).json({ success: false, error: err.message || 'Invalid parameters' });
  }
});

export default router;
