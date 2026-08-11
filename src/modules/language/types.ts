import type { LanguageCode, Level } from '../../config/constants';

export type { LanguageCode, Level };

export interface Word {
  word: string;
  translation: string;
  example: string;
  transcription?: string;
}

export interface DialogueLine {
  role: string;
  text: string;
}

export interface Lesson {
  id: string;
  language: LanguageCode;
  level: Level;
  lesson_num: number;
  topic: string;
  words: Word[];
  dialogue: DialogueLine[];
  homework: string;
  quest: string;
  grammar_note?: string;
  created_at: number;
}

export interface ReviewResult {
  nextInterval: number;
  newEaseFactor: number;
  nextReviewAt: number;
}

export interface LanguageProgress {
  id: string;
  tenant_id: string;
  word: string;
  translation: string;
  example: string;
  transcription?: string;
  next_review_at: number;
  review_count: number;
  ease_factor: number;
  interval_days: number;
  last_reviewed_at: number | null;
  mastery: number;
  created_at: string;
}

export interface LanguageSettings {
  tenant_id: string;
  target_language: LanguageCode;
  native_language: string;
  level: Level;
  daily_goal: number;
  streak: number;
  total_words_learned: number;
  current_lesson: number;
  started_at: string;
}
