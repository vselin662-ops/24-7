/**
 * Selin AI 2.0 - Core Type Definitions
 * Объединённая система типов для мультиагентной платформы Selin AI и проекта Pilgrim.
 * Включает контракты для агентов, адаптеров, контекста, памяти и будущих подсистем (Voice, Camera Vision, Geolocation).
 */

// ==========================================
// 1. Каналы коммуникации (ChannelType)
// ==========================================
export enum ChannelType {
  MAX = 'max',
  TELEGRAM = 'telegram',
  VOICE = 'voice',
  WEB = 'web',
  WHATSAPP = 'whatsapp',
  ROBOT = 'robot',
  INTERNAL = 'internal'
}

// ==========================================
// 2. Типы задач мультиагентной системы (TaskType)
// ==========================================
export enum TaskType {
  ORDER = 'order',
  TRAVEL = 'travel',
  NEWS = 'news',
  CONTENT = 'content',
  CODING = 'coding',
  VOICE = 'voice',
  HEALTH = 'health',
  WEATHER = 'weather',
  MARKETING = 'marketing',
  EDUCATION = 'education',

  // Обратная совместимость для существующих модулей
  ORDER_PROCESSING = 'order',
  VOICE_INTERACTION = 'voice',
  CONTENT_GENERATION = 'content',
  LEAD_GENERATION = 'marketing',
  CUSTOMER_SUPPORT = 'customer_support',
  BUSINESS_AUTOMATION = 'business_automation',
  MARKET_RESEARCH = 'news',
  DATA_SYNTHESIS = 'coding',
  SMART_REMINDER = 'health'
}

// ==========================================
// 3. Приоритеты задач (TaskPriority)
// ==========================================
export enum TaskPriority {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical'
}

// ==========================================
// Подсистемы данных: Геолокация, Камера, Голос
// ==========================================
export interface GeoLocation {
  latitude: number;
  longitude: number;
  accuracyMeters?: number;
  altitude?: number;
  speed?: number;
  heading?: number;
  address?: string;
  city?: string;
  country?: string;
  timestamp?: number;
}

export interface CameraFrame {
  imageUrl?: string;
  imageBase64?: string;
  mimeType?: string;
  width?: number;
  height?: number;
  detectedObjects?: Array<{ label: string; confidence: number; boundingBox?: number[] }>;
  ocrText?: string;
  timestamp?: number;
}

export interface VoiceMetadata {
  durationSeconds?: number;
  sampleRate?: number;
  channels?: number;
  format?: 'ogg' | 'mp3' | 'wav' | 'pcm' | 'aac' | string;
  language?: string;
  emotion?: 'neutral' | 'happy' | 'sad' | 'angry' | 'excited' | 'urgent' | string;
  speakerId?: string;
  isStreaming?: boolean;
}

// ==========================================
// 4. Контекст сообщения (MessageContext)
// ==========================================
export interface MessageContext {
  chatId: string;
  tenantId: string;
  channel: ChannelType;
  isVoice: boolean;
  audioUrl?: string;
  audioBuffer?: Buffer;
  senderId?: string;
  senderName?: string;
  timestamp?: number;

  // Поля для расширенных подсистем (голос, камера, локация)
  location?: GeoLocation;
  camera?: CameraFrame;
  voiceMeta?: VoiceMetadata;

  // Метаданные платформы и авторизации
  tenantRole?: string;
  isTrusted?: boolean;
  metadata?: Record<string, any>;
}

// ==========================================
// Действия AI (AIAction)
// ==========================================
export interface AIAction {
  id: string;
  type: string;
  payload: Record<string, any>;
  executed?: boolean;
  description?: string;
}

// ==========================================
// 5. Ответ AI-системы (AIResponse)
// ==========================================
export interface AIResponse {
  text: string;
  voice?: {
    audioBase64?: string;
    audioUrl?: string;
    durationSeconds?: number;
    format?: string;
    voiceName?: string;
  };
  actions?: AIAction[];
  confidence: number;
  suggestedReplies?: string[];
  visualData?: {
    images?: string[];
    charts?: any;
    uiComponent?: string;
  };
  locationData?: {
    destination?: string;
    coordinates?: { lat: number; lng: number };
  };
  metadata?: Record<string, any>;
}

// ==========================================
// 6. Сообщение диалога (ChatMessage)
// ==========================================
export interface ChatMessage {
  role: 'user' | 'assistant' | 'system' | 'model';
  content: string;
  timestamp?: number;
  mediaType?: 'text' | 'voice' | 'image' | 'video' | 'file' | 'location';
  mediaUrl?: string;
  location?: GeoLocation;
  camera?: CameraFrame;
  voice?: VoiceMetadata;
  metadata?: Record<string, any>;
}

// ==========================================
// 7. Память диалога (ChatMemory)
// ==========================================
export interface ChatMemory {
  history: ChatMessage[];
  lastTopic?: string;
  userIntent?: string;
  summary?: string;
  entities?: Record<string, any>;
  sentiment?: 'positive' | 'neutral' | 'negative' | string;
  lastLocation?: GeoLocation;
  lastUpdated?: number;
  contextVariables?: Record<string, any>;
}

// ==========================================
// 8. Задача для агента (Task)
// ==========================================
export interface Task {
  id: string;
  type: TaskType;
  priority: TaskPriority;
  payload: Record<string, any>;
  context: MessageContext;
  status?: 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled';
  assignedAgent?: string;
  createdAt?: number;
  completedAt?: number;
  result?: any;
  error?: string;
  tags?: string[];
}

// ==========================================
// 9. Настройки и профиль пользователя (UserProfile)
// ==========================================
export interface UserPreferences {
  language?: string;
  voiceSpeed?: number;
  voiceName?: string;
  notificationsEnabled?: boolean;
  communicationStyle?: 'concise' | 'detailed' | 'formal' | 'casual';
  customInstructions?: string;
  theme?: 'dark' | 'light' | 'system';
  allowLocationAccess?: boolean;
  allowCameraAccess?: boolean;
  preferredChannel?: ChannelType;
}

export interface UserProfile {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  location?: GeoLocation;
  preferences: UserPreferences;
  config: Record<string, any>;
  tenantId?: string;
  role?: string;
  tags?: string[];
  createdAt?: number;
  updatedAt?: number;
}

// ==========================================
// 10. Возможности агента (AgentCapability)
// ==========================================
export enum AgentCapabilityType {
  TEXT_GENERATION = 'text_generation',
  VOICE_SYNTHESIS = 'voice_synthesis',
  VOICE_RECOGNITION = 'voice_recognition',
  VISION_ANALYSIS = 'vision_analysis',
  GEOLOCATION_SERVICES = 'geolocation_services',
  WEB_SEARCH = 'web_search',
  CODE_EXECUTION = 'code_execution',
  EXTERNAL_API_CALL = 'external_api_call',
  DATABASE_PERSISTENCE = 'database_persistence'
}

export interface AgentCapability {
  name: string;
  description: string;
  supportedTaskTypes: TaskType[];
  capabilities: AgentCapabilityType[];
  supportsVoice: boolean;
  supportsCamera: boolean;
  supportsLocation: boolean;
  requiredPermissions?: string[];
  rateLimitPerMinute?: number;
}

// ==========================================
// Дополнительные типы из проекта Pilgrim & Selin
// ==========================================
export interface SMARTTask {
  id: string;
  title: string;
  agent: 'receiver' | 'content' | 'sales' | 'analyst' | 'operator' | string;
  specific: string;
  measurable: string;
  achievable: string;
  relevant: string;
  time_bound: string;
  priority: 'high' | 'medium' | 'low';
  completed?: boolean;
  result?: string;
}

export interface AppConfig {
  project_name: string;
  owner_name: string;
  business_name: string;
  industry: string;
  channels: string[];
  tone: 'friendly' | 'professional' | 'energetic' | 'elegant' | 'strict';
  autonomy_level: 'full' | 'human-supervised';
  voice_id: string;
  voice_vector_encrypted?: string;
  is_active: boolean;
  auto_synthesize?: boolean;
  tts_voice?: string;
  agent_missions?: Record<string, string>;
  is_live?: boolean;
  readiness?: { kb_ready: boolean; channel_ready: boolean; tone_ready: boolean; missions_ready: boolean };
}

export interface SynthesizedProfile {
  niche_and_positioning: string;
  key_metrics: string;
  resources_and_capacity: string;
  constraints_and_risks: string;
  target_audience: string;
  strategic_focus: string;
}
