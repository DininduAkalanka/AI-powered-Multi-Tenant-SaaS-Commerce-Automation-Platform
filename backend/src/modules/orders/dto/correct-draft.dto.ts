import { IsObject, IsNotEmpty } from 'class-validator';

/**
 * CorrectDraftDto
 *
 * Payload sent when an owner edits a draft order's AI-extracted data
 * before approving. The corrected data is diffed against the original
 * and stored in AIDraftOrder.humanCorrections for AI training signals.
 */
export class CorrectDraftDto {
  @IsObject()
  @IsNotEmpty()
  correctedData: Record<string, unknown>;
}
