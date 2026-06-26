import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../common/database/prisma.service';
import { AIProcessingStage } from '@prisma/client';
import { ExtractedOrder } from './entity-extractor.service';

export interface ConfidenceScores {
  intentConfidence: number;
  productMatchConfidence: number;
  completenessScore: number;
  overallConfidence: number;
  routing: ConfidenceRouting;
  explanation: string[];
}

export type ConfidenceRouting =
  | 'AUTO_APPROVE_ELIGIBLE'  // >= 0.95 on all sub-scores and auto-approve enabled
  | 'OWNER_REVIEW'           // 0.70 - 0.94
  | 'FLAGGED_LOW_CONFIDENCE' // < 0.70 — needs manual attention
  | 'INCOMPLETE_ORDER';      // Missing required fields

/**
 * ConfidenceScorerService
 *
 * Stage 4 of the AI pipeline.
 * Calculates composite confidence scores from the previous pipeline stages.
 * Determines routing: auto-approve eligible, owner review, or flagged.
 *
 * Sub-scores:
 * - intentConfidence: from Stage 1 (IntentDetector)
 * - productMatchConfidence: average of item match scores from Stage 3
 * - completenessScore: penalty for missing required fields
 * - overallConfidence: weighted average of all sub-scores
 */
@Injectable()
export class ConfidenceScorerService {
  private readonly logger = new Logger(ConfidenceScorerService.name);

  // Weights for overall confidence calculation
  private readonly WEIGHTS = {
    intent: 0.3,
    productMatch: 0.4,
    completeness: 0.3,
  };

  constructor(private readonly prisma: PrismaService) {}

  async score(
    tenantId: string,
    messageId: string,
    intentConfidence: number,
    extractedOrder: ExtractedOrder,
    autoApproveEnabled: boolean,
    autoApproveThreshold: number,
    reviewThreshold: number,
  ): Promise<ConfidenceScores> {
    const startTime = Date.now();

    // Calculate product match confidence (average across all items)
    const productMatchConfidence =
      extractedOrder.items.length > 0
        ? extractedOrder.items.reduce(
            (sum, item) => sum + (item.match_confidence ?? 0),
            0,
          ) / extractedOrder.items.length
        : 0;

    // Calculate completeness score based on missing fields
    const completenessScore = this.calculateCompleteness(extractedOrder);

    // Weighted overall confidence
    const overallConfidence =
      intentConfidence * this.WEIGHTS.intent +
      productMatchConfidence * this.WEIGHTS.productMatch +
      completenessScore * this.WEIGHTS.completeness;

    // Build human-readable explanation
    const explanation = this.buildExplanation(
      intentConfidence,
      productMatchConfidence,
      completenessScore,
      overallConfidence,
      extractedOrder.missing_fields,
    );

    // Routing decision
    const routing = this.determineRouting(
      overallConfidence,
      extractedOrder.missing_fields,
      autoApproveEnabled,
      autoApproveThreshold,
      reviewThreshold,
    );

    const scores: ConfidenceScores = {
      intentConfidence,
      productMatchConfidence,
      completenessScore,
      overallConfidence,
      routing,
      explanation,
    };

    const processingTimeMs = Date.now() - startTime;

    // Log this stage
    await this.prisma.aIProcessingLog.create({
      data: {
        tenantId,
        messageId,
        stage: AIProcessingStage.CONFIDENCE_SCORING,
        inputData: {
          intentConfidence,
          productMatchConfidence,
          completenessScore,
          missingFields: extractedOrder.missing_fields,
        },
        outputData: scores as object,
        modelUsed: 'rule-based-scorer',
        promptVersion: '1.0.0',
        processingTimeMs,
        intentConfidence,
        productMatchConfidence,
        completenessScore,
        overallConfidence,
        success: true,
      },
    });

    this.logger.log(
      `[${tenantId}] Confidence: ${(overallConfidence * 100).toFixed(1)}% → ${routing}`,
    );

    return scores;
  }

  // ── Private helpers ────────────────────────────────────────────

  private calculateCompleteness(order: ExtractedOrder): number {
    if (order.missing_fields.length === 0 && order.items.length > 0) {
      return 1.0;
    }

    const REQUIRED_FIELDS = ['product', 'quantity'];
    const OPTIONAL_FIELDS = ['delivery_address', 'size', 'color'];

    const missingRequired = order.missing_fields.filter((f) =>
      REQUIRED_FIELDS.includes(f),
    ).length;
    const missingOptional = order.missing_fields.filter((f) =>
      OPTIONAL_FIELDS.includes(f),
    ).length;

    // Missing required fields = much bigger penalty
    const penalty = missingRequired * 0.4 + missingOptional * 0.1;
    return Math.max(0, 1.0 - penalty);
  }

  private determineRouting(
    overallConfidence: number,
    missingFields: string[],
    autoApproveEnabled: boolean,
    autoApproveThreshold: number,
    reviewThreshold: number,
  ): ConfidenceRouting {
    const hasMissingRequired = missingFields.some(
      (f) => f === 'product' || f === 'quantity',
    );

    if (hasMissingRequired) {
      return 'INCOMPLETE_ORDER';
    }

    if (
      autoApproveEnabled &&
      overallConfidence >= autoApproveThreshold
    ) {
      return 'AUTO_APPROVE_ELIGIBLE';
    }

    if (overallConfidence >= reviewThreshold) {
      return 'OWNER_REVIEW';
    }

    return 'FLAGGED_LOW_CONFIDENCE';
  }

  private buildExplanation(
    intentConfidence: number,
    productMatchConfidence: number,
    completenessScore: number,
    overallConfidence: number,
    missingFields: string[],
  ): string[] {
    const lines: string[] = [
      `Overall confidence: ${(overallConfidence * 100).toFixed(1)}%`,
      `• Intent recognition: ${(intentConfidence * 100).toFixed(1)}%`,
      `• Product match: ${(productMatchConfidence * 100).toFixed(1)}%`,
      `• Order completeness: ${(completenessScore * 100).toFixed(1)}%`,
    ];

    if (missingFields.length > 0) {
      lines.push(`Missing: ${missingFields.join(', ')}`);
    }

    return lines;
  }
}
