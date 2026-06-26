import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  GoogleGenerativeAI,
  GenerativeModel,
  GenerationConfig,
} from '@google/generative-ai';

/**
 * GeminiAdapter
 *
 * Abstracted interface to Google Gemini Flash API.
 * All AI calls go through here — never call Gemini SDK directly from services.
 *
 * Free tier: Gemini 1.5 Flash
 * - 1M tokens/day free
 * - 15 requests/minute
 * - No credit card required
 */
@Injectable()
export class GeminiAdapter {
  private readonly logger = new Logger(GeminiAdapter.name);
  private readonly client: GoogleGenerativeAI;
  private readonly model: GenerativeModel;
  private readonly modelName: string;

  constructor(private readonly configService: ConfigService) {
    const apiKey = this.configService.getOrThrow<string>('GEMINI_API_KEY');
    this.modelName = this.configService.get<string>('GEMINI_MODEL', 'gemini-1.5-flash');

    this.client = new GoogleGenerativeAI(apiKey);
    this.model = this.client.getGenerativeModel({
      model: this.modelName,
    });
  }

  /**
   * Generate a text response from Gemini.
   * Returns the raw text and usage metadata.
   */
  async generateText(
    systemPrompt: string,
    userPrompt: string,
    config?: Partial<GenerationConfig>,
  ): Promise<GeminiResponse> {
    const startTime = Date.now();

    try {
      const generationConfig: GenerationConfig = {
        temperature: parseFloat(
          this.configService.get('GEMINI_TEMPERATURE', '0.1'),
        ),
        maxOutputTokens: parseInt(
          this.configService.get('GEMINI_MAX_TOKENS', '2048'),
        ),
        ...config,
      };

      const result = await this.model.generateContent({
        systemInstruction: systemPrompt,
        contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
        generationConfig,
      });

      const response = result.response;
      const text = response.text();
      const processingTimeMs = Date.now() - startTime;

      this.logger.debug(
        `Gemini response in ${processingTimeMs}ms (${text.length} chars)`,
      );

      return {
        text,
        modelUsed: this.modelName,
        processingTimeMs,
        tokenCount: response.usageMetadata?.totalTokenCount,
        success: true,
      };
    } catch (error: unknown) {
      const processingTimeMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      this.logger.error(`Gemini API error: ${errorMessage}`);

      return {
        text: '',
        modelUsed: this.modelName,
        processingTimeMs,
        success: false,
        error: errorMessage,
      };
    }
  }

  /**
   * Parse a JSON response from Gemini.
   * Strips markdown code fences that Gemini sometimes adds.
   */
  parseJsonResponse<T>(text: string): T {
    // Remove markdown code fences if present
    const cleaned = text
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();

    return JSON.parse(cleaned) as T;
  }

  /**
   * Generate embeddings for product catalog RAG.
   * Uses text-embedding-004 (768 dimensions, free).
   */
  async generateEmbedding(text: string): Promise<number[]> {
    const embeddingModel = this.configService.get<string>(
      'GEMINI_EMBEDDING_MODEL',
      'text-embedding-004',
    );

    const embeddingClient = this.client.getGenerativeModel({
      model: embeddingModel,
    });

    const result = await embeddingClient.embedContent(text);
    return result.embedding.values;
  }
}

export interface GeminiResponse {
  text: string;
  modelUsed: string;
  processingTimeMs: number;
  tokenCount?: number;
  success: boolean;
  error?: string;
}
