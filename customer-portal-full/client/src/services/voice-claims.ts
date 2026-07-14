/**
 * Voice-based claim submission using Web Speech API
 * Supports English, Hausa, Yoruba, Igbo, Nigerian Pidgin
 */

export interface TranscriptionResult {
  text: string;
  language: string;
  confidence: number;
  isInterim: boolean;
}

export interface VoiceClaimData {
  transcription: string;
  claimType?: string;
  description: string;
  location?: string;
  incidentDate?: string;
  language: string;
}

const LANGUAGE_MAP: Record<string, string> = {
  en: 'en-NG',    // English (Nigeria)
  ha: 'ha-NG',    // Hausa
  yo: 'yo-NG',    // Yoruba
  ig: 'ig-NG',    // Igbo
  pcm: 'en-NG',   // Nigerian Pidgin (falls back to English recognition)
};

export class VoiceClaimService {
  private recognition: SpeechRecognition | null = null;
  private isListening = false;
  private transcript = '';

  constructor() {
    if (typeof window !== 'undefined') {
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (SpeechRecognition) {
        this.recognition = new SpeechRecognition();
        this.recognition.continuous = true;
        this.recognition.interimResults = true;
        this.recognition.maxAlternatives = 3;
      }
    }
  }

  get isSupported(): boolean {
    return this.recognition !== null;
  }

  get listening(): boolean {
    return this.isListening;
  }

  setLanguage(lang: string): void {
    if (this.recognition) {
      this.recognition.lang = LANGUAGE_MAP[lang] || 'en-NG';
    }
  }

  start(
    language: string,
    onResult: (result: TranscriptionResult) => void,
    onError: (error: string) => void,
    onEnd: () => void,
  ): void {
    if (!this.recognition) {
      onError('Speech recognition not supported in this browser');
      return;
    }

    this.setLanguage(language);
    this.transcript = '';
    this.isListening = true;

    this.recognition.onresult = (event: SpeechRecognitionEvent) => {
      let interimTranscript = '';
      let finalTranscript = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          finalTranscript += result[0].transcript;
        } else {
          interimTranscript += result[0].transcript;
        }
      }

      if (finalTranscript) {
        this.transcript += finalTranscript;
        onResult({
          text: this.transcript,
          language,
          confidence: event.results[event.results.length - 1][0].confidence,
          isInterim: false,
        });
      } else if (interimTranscript) {
        onResult({
          text: this.transcript + interimTranscript,
          language,
          confidence: 0,
          isInterim: true,
        });
      }
    };

    this.recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      this.isListening = false;
      onError(event.error);
    };

    this.recognition.onend = () => {
      this.isListening = false;
      onEnd();
    };

    this.recognition.start();
  }

  stop(): string {
    if (this.recognition && this.isListening) {
      this.recognition.stop();
      this.isListening = false;
    }
    return this.transcript;
  }

  /**
   * Extract structured claim data from transcribed text using simple NLU
   */
  extractClaimData(text: string, language: string): VoiceClaimData {
    const lowerText = text.toLowerCase();

    // Detect claim type from keywords
    let claimType: string | undefined;
    if (/car|motor|vehicle|accident|crash|collision|bumper/.test(lowerText)) {
      claimType = 'motor';
    } else if (/hospital|doctor|medical|health|surgery|sick/.test(lowerText)) {
      claimType = 'health';
    } else if (/house|property|fire|flood|theft|burglary/.test(lowerText)) {
      claimType = 'property';
    } else if (/travel|flight|luggage|trip|abroad/.test(lowerText)) {
      claimType = 'travel';
    }

    // Extract location (simple pattern matching for Nigerian locations)
    const locationMatch = text.match(/(?:at|in|near|on)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/);
    const location = locationMatch ? locationMatch[1] : undefined;

    // Extract date references
    let incidentDate: string | undefined;
    if (/yesterday/.test(lowerText)) {
      const d = new Date();
      d.setDate(d.getDate() - 1);
      incidentDate = d.toISOString().split('T')[0];
    } else if (/today/.test(lowerText)) {
      incidentDate = new Date().toISOString().split('T')[0];
    }

    return {
      transcription: text,
      claimType,
      description: text,
      location,
      incidentDate,
      language,
    };
  }
}

export const voiceClaimService = new VoiceClaimService();
