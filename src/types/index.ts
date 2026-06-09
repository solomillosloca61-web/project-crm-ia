export interface Contact {
  id: string;
  phone: string;
  name?: string;
  email?: string;
  source?: string;
  status?: string;
  score?: number;
  notes?: string;
  calendly_link?: string;
  created_at?: string;
  updated_at?: string;
  has_chat_messages?: boolean;
}

export interface Conversation {
  id: string;
  contact_id: string;
  started_at?: string;
  last_message?: string;
  intent?: string;
  resolved?: boolean;
}

export interface Message {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  tokens_used?: number;
  created_at?: string;
}
