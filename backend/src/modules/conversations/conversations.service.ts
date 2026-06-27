import { Injectable, Logger } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '../../common/database/prisma.service';
import { ConversationStateService, ConversationSession } from './conversation-state.service';
import { ConversationStage, ConversationStatus } from '@prisma/client';

export interface ActiveConversationResult {
  conversation: { id: string; customerId: string; phone: string };
  session: ConversationSession;
  isNew: boolean;
}

/**
 * ConversationsService
 *
 * Orchestrates the two-layer conversation system:
 *   - Layer 1 (Hot): Redis session via ConversationStateService
 *   - Layer 2 (Cold): PostgreSQL Conversation record via PrismaService
 *
 * Responsibilities:
 *   1. Find or create a Conversation record in DB + Redis session
 *   2. Add messages to session history
 *   3. Transition conversation stages
 *   4. Complete or abandon conversations
 *
 * Architecture Rule: Business logic lives here. WhatsApp module
 * simply calls this service — it does NOT touch the Conversation table directly.
 */
@Injectable()
export class ConversationsService {
  private readonly logger = new Logger(ConversationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly conversationState: ConversationStateService,
  ) {}

  /**
   * Find an existing ACTIVE conversation for this tenant+phone,
   * or create a new one if none exists (or previous one expired/completed).
   *
   * This is called at the start of every incoming message processing.
   */
  async findOrCreateConversation(
    tenantId: string,
    customerId: string,
    phone: string,
  ): Promise<ActiveConversationResult> {
    // Check Redis first (hot path — avoids DB call for ongoing conversations)
    const existingSession = await this.conversationState.getSession(tenantId, phone);

    if (existingSession) {
      this.logger.log(`[${tenantId}] Resuming existing conversation for ${phone}`);
      return {
        conversation: {
          id: existingSession.conversationId,
          customerId: existingSession.customerId,
          phone: existingSession.phone,
        },
        session: existingSession,
        isNew: false,
      };
    }

    // Redis session expired — check if there's an ACTIVE DB record
    // (could happen if backend restarted and Redis was cleared)
    const existingDbConversation = await this.prisma.conversation.findFirst({
      where: {
        tenantId,
        phone,
        status: ConversationStatus.ACTIVE,
      },
      orderBy: { startedAt: 'desc' },
    });

    if (existingDbConversation) {
      // Recreate Redis session from DB record (hydration after restart)
      this.logger.log(`[${tenantId}] Hydrating conversation from DB for ${phone}`);
      const session = await this.conversationState.createSession(
        existingDbConversation.id,
        tenantId,
        customerId,
        phone,
      );
      return {
        conversation: existingDbConversation,
        session,
        isNew: false,
      };
    }

    // Truly new conversation — create in DB and Redis
    return this.startNewConversation(tenantId, customerId, phone);
  }

  /**
   * Append a customer message to the active conversation history.
   */
  async addCustomerMessage(
    tenantId: string,
    phone: string,
    message: string,
  ): Promise<void> {
    await this.conversationState.appendMessage(tenantId, phone, 'customer', message);

    // Update lastMessageAt in DB
    await this.prisma.conversation.updateMany({
      where: { tenantId, phone, status: ConversationStatus.ACTIVE },
      data: { lastMessageAt: new Date() },
    });
  }

  /**
   * Append a bot reply to the conversation history.
   */
  async addBotReply(
    tenantId: string,
    phone: string,
    reply: string,
  ): Promise<void> {
    await this.conversationState.appendMessage(tenantId, phone, 'bot', reply);
  }

  /**
   * Update conversation state after an AI extraction attempt.
   * Called by WhatsAppService after the AI pipeline runs.
   */
  async updateAfterExtraction(
    tenantId: string,
    phone: string,
    partialOrderData: Record<string, unknown>,
    missingFields: string[],
  ): Promise<void> {
    const newStage =
      missingFields.length > 0
        ? ConversationStage.COLLECTING_DETAILS
        : ConversationStage.CONFIRMING_ORDER;

    await this.conversationState.updatePartialOrder(
      tenantId,
      phone,
      partialOrderData,
      missingFields,
      newStage,
    );

    // Persist stage to DB
    await this.prisma.conversation.updateMany({
      where: { tenantId, phone, status: ConversationStatus.ACTIVE },
      data: {
        currentStage: newStage,
        partialOrderData: partialOrderData as object,
        lastMessageAt: new Date(),
      },
    });
  }

  /**
   * Mark a conversation as COMPLETED.
   * Called when a draft order has been successfully created.
   * Clears the Redis session and updates the DB record.
   */
  async completeConversation(tenantId: string, phone: string): Promise<void> {
    await this.conversationState.deleteSession(tenantId, phone);

    await this.prisma.conversation.updateMany({
      where: { tenantId, phone, status: ConversationStatus.ACTIVE },
      data: {
        status: ConversationStatus.COMPLETED,
        currentStage: ConversationStage.COMPLETED,
        endedAt: new Date(),
      },
    });

    this.logger.log(`[${tenantId}] Conversation completed for ${phone}`);
  }

  /**
   * Mark a conversation as ABANDONED.
   * Called by cleanup jobs when Redis TTL expires without completion.
   */
  async abandonConversation(tenantId: string, phone: string): Promise<void> {
    await this.conversationState.deleteSession(tenantId, phone);

    await this.prisma.conversation.updateMany({
      where: { tenantId, phone, status: ConversationStatus.ACTIVE },
      data: {
        status: ConversationStatus.ABANDONED,
        endedAt: new Date(),
      },
    });

    this.logger.log(`[${tenantId}] Conversation abandoned for ${phone}`);
  }

  /**
   * Get the full message history for an active conversation session.
   * Returns an empty array if no active session exists.
   */
  async getMessageHistory(tenantId: string, phone: string): Promise<string[]> {
    const session = await this.conversationState.getSession(tenantId, phone);
    return session?.messageHistory ?? [];
  }

  // ── Private helpers ──────────────────────────────────────────────

  private async startNewConversation(
    tenantId: string,
    customerId: string,
    phone: string,
  ): Promise<ActiveConversationResult> {
    const conversationId = uuidv4();

    // Create DB record — source of truth for conversation history
    const conversation = await this.prisma.conversation.create({
      data: {
        id: conversationId,
        tenantId,
        customerId,
        phone,
        status: ConversationStatus.ACTIVE,
        currentStage: ConversationStage.STARTED,
      },
    });

    // Create Redis session — source of truth for active state
    const session = await this.conversationState.createSession(
      conversationId,
      tenantId,
      customerId,
      phone,
    );

    this.logger.log(`[${tenantId}] New conversation started: ${conversationId} for ${phone}`);

    return { conversation, session, isNew: true };
  }
}
