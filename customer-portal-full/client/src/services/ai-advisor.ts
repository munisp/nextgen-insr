/**
 * AI Insurance Advisor — Client SDK
 * Connects to the AI Advisor service (port 8110)
 * Supports offline queueing and multi-language
 */

export type Language = 'en' | 'pcm' | 'ha' | 'yo' | 'ig';

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  language: Language;
}

export interface ChatResponse {
  conversation_id: string;
  response: string;
  intent: string;
  confidence: number;
  language: Language;
  suggestions: string[];
  escalate: boolean;
  sources: string[];
}

export interface AdvisorConfig {
  baseUrl: string;
  language: Language;
  customerId: string;
}

class AIAdvisorClient {
  private baseUrl: string;
  private language: Language;
  private customerId: string;
  private conversationId: string | null = null;
  private offlineQueue: Array<{ message: string; timestamp: string }> = [];

  constructor(config: AdvisorConfig) {
    this.baseUrl = config.baseUrl || '/api/v1/advisor';
    this.language = config.language || 'en';
    this.customerId = config.customerId;
  }

  async chat(message: string): Promise<ChatResponse> {
    try {
      const response = await fetch(`${this.baseUrl}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customer_id: this.customerId,
          message,
          conversation_id: this.conversationId,
          language: this.language,
        }),
      });

      if (!response.ok) {
        throw new Error(`AI Advisor error: ${response.status}`);
      }

      const data: ChatResponse = await response.json();
      this.conversationId = data.conversation_id;
      return data;
    } catch (error) {
      // Offline-first: queue message for later sync
      this.offlineQueue.push({ message, timestamp: new Date().toISOString() });
      return {
        conversation_id: this.conversationId || 'offline',
        response: this.getOfflineResponse(message),
        intent: 'general_question',
        confidence: 0.5,
        language: this.language,
        suggestions: ['Try again when online', 'Call support: 0800-INSURE'],
        escalate: false,
        sources: [],
      };
    }
  }

  async getProactiveMessage(trigger: string = 'renewal'): Promise<{ message: string }> {
    const response = await fetch(
      `${this.baseUrl}/proactive?customer_id=${this.customerId}&trigger=${trigger}`,
      { method: 'POST' }
    );
    return response.json();
  }

  setLanguage(language: Language) {
    this.language = language;
  }

  getOfflineQueue() {
    return [...this.offlineQueue];
  }

  async syncOfflineQueue(): Promise<void> {
    while (this.offlineQueue.length > 0) {
      const item = this.offlineQueue.shift()!;
      await this.chat(item.message);
    }
  }

  private getOfflineResponse(message: string): string {
    const offlineResponses: Record<Language, string> = {
      en: "I'm currently offline. Your message has been saved and will be processed when you're back online.",
      pcm: "I no dey online now. Your message don save — I go answer when network come back.",
      ha: "Ba ni da haɗin yanar gizo yanzu. An adana saƙonku — zan amsa idan yanar gizo ta dawo.",
      yo: "Mi ko si lori ayelujara bayi. A ti fi ifiranṣẹ rẹ pamọ — Emi yoo dahun nigbati ayelujara ba pada.",
      ig: "Anọ m n'ịntanetị ugbu a. Ozi gị edekọtara — m ga-aza mgbe ịntanetị lọghachiri.",
    };
    return offlineResponses[this.language];
  }
}

export function createAdvisorClient(config: AdvisorConfig): AIAdvisorClient {
  return new AIAdvisorClient(config);
}

export default AIAdvisorClient;
