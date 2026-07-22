export interface Agent {
  id: string;
  role: 'receiver' | 'content' | 'sales' | 'analyst' | 'operator';
  name: string;
  russianRole: string;
  description: string;
  icon: string;
  systemPrompt: string;
  status: 'active' | 'idle' | 'executing';
  channels: string[];
}

export interface SMARTTask {
  id: string;
  title: string;
  agent: 'receiver' | 'content' | 'sales' | 'analyst' | 'operator';
  specific: string;
  measurable: string;
  achievable: string;
  relevant: string;
  time_bound: string;
  priority: 'high' | 'medium' | 'low';
  completed?: boolean;
  result?: string;
}

export interface Message {
  role: 'user' | 'model';
  content: string;
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

export interface SimulatedCustomer {
  id: string;
  name: string;
  channel: 'telegram' | 'whatsapp' | 'vk' | 'email';
  avatar: string;
  lastMessage: string;
  timestamp: string;
  history: { sender: 'customer' | 'agent'; text: string; hasAudio?: boolean; audioBase64?: string }[];
}

export interface ModerationItem {
  id: string;
  chatId: string;
  clientName: string;
  channel: 'telegram' | 'whatsapp' | 'vk' | 'email';
  userMessage: string;
  proposedResponse: string;
  agentRole: 'receiver' | 'content' | 'sales' | 'analyst' | 'operator';
  timestamp: string;
}

export interface ModerationLogEntry {
  id: string;
  chatId: string;
  clientName: string;
  channel: 'telegram' | 'whatsapp' | 'vk' | 'email';
  userMessage: string;
  proposedResponse: string;
  finalResponse: string | null;
  action: 'approve' | 'edit' | 'reject';
  agentRole: 'receiver' | 'content' | 'sales' | 'analyst' | 'operator';
  timestamp: string;
}

export interface SynthesizedProfile {
  niche_and_positioning: string;
  key_metrics: string;
  resources_and_capacity: string;
  constraints_and_risks: string;
  target_audience: string;
  strategic_focus: string;
}

