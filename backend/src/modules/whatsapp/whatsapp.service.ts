import { Injectable, Logger, Inject } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '../../common/database/prisma.service';
import { AiEngineService } from '../ai-engine/ai-engine.service';
import { ConversationsService } from '../conversations/conversations.service';
import type {
  IWhatsAppAdapter,
} from './interfaces/whatsapp-adapter.interface';
import { WHATSAPP_ADAPTER } from './interfaces/whatsapp-adapter.interface';
import { MockWhatsAppAdapter } from './adapters/mock-whatsapp.adapter';
import { MessageDirection, MessageType, MessageStatus } from '@prisma/client';

/**
 * WhatsAppService
 *
 * Handles:
 * 1. Parsing incoming Meta webhook payloads
 * 2. Storing messages to DB
 * 3. Finding/creating customer records
 * 4. Managing multi-turn conversation state (Phase 2)
 * 5. Triggering AI processing with conversation context
 * 6. Sending replies
 *
 * Phase 2 change: Every message is now processed within a conversation context.
 * The ConversationsService manages Redis session state across turns.
 */
@Injectable()
export class WhatsAppService {
  private readonly logger = new Logger(WhatsAppService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly aiEngine: AiEngineService,
    private readonly conversationsService: ConversationsService,
    @Inject(WHATSAPP_ADAPTER)
    private readonly whatsappAdapter: IWhatsAppAdapter,
  ) {}

  /**
   * Handle incoming webhook payload from Meta Cloud API.
   * Parses message, stores it, and triggers async AI processing.
   *
   * IMPORTANT: Always return 200 immediately to Meta.
   * If Meta doesn't get 200 within 20 seconds, it retries the webhook.
   */
  async handleIncomingWebhook(
    payload: Record<string, unknown>,
    _signature: string,
  ): Promise<void> {
    try {
      // TODO: Verify HMAC signature in production
      // const isValid = this.verifySignature(payload, signature);
      // if (!isValid) throw new ForbiddenException('Invalid webhook signature')

      const entry = (payload as any)?.entry?.[0];
      if (!entry) return;

      const changes = entry?.changes?.[0];
      if (!changes || changes.field !== 'messages') return;

      const messages = changes?.value?.messages;
      if (!Array.isArray(messages) || messages.length === 0) return;

      // Find the tenant by phone number ID
      const phoneNumberId = changes?.value?.metadata?.phone_number_id;
      const tenant = await this.prisma.tenant.findFirst({
        where: { whatsappPhoneNumberId: phoneNumberId, isActive: true },
      });

      if (!tenant) {
        this.logger.warn(`No tenant found for phone number ID: ${phoneNumberId}`);
        return;
      }

      for (const message of messages) {
        await this.processMessage(tenant.id, message);
      }
    } catch (error) {
      this.logger.error(`Webhook processing error: ${error}`);
      // Don't throw — always return 200 to Meta
    }
  }

  /**
   * Simulate an incoming WhatsApp message (mock mode only).
   * Used by the dashboard simulator for testing without a real Meta account.
   */
  async simulateIncomingMessage(
    tenantId: string,
    phone: string,
    messageText: string,
  ) {
    const adapter = this.whatsappAdapter as MockWhatsAppAdapter;
    const simulated = adapter.simulateIncomingMessage(phone, messageText);

    // Process as if it came from the real webhook
    await this.processIncomingText(
      tenantId,
      phone,
      messageText,
      simulated.messageId,
    );

    return simulated;
  }

  /**
   * Get messages from mock simulator (for dashboard UI).
   */
  async getSimulatorMessages(tenantId: string): Promise<unknown[]> {
    // Get recent messages from DB for this tenant
    const messages = await this.prisma.whatsAppMessage.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: { customer: true },
    });
    return messages;
  }

  // ── Private helpers ────────────────────────────────────────────

  private async processMessage(
    tenantId: string,
    rawMessage: Record<string, unknown>,
  ): Promise<void> {
    const messageType = this.getMessageType(rawMessage.type as string);
    const phone = rawMessage.from as string;
    const externalId = rawMessage.id as string;
    const text = (rawMessage.text as any)?.body ?? '';

    if (messageType !== MessageType.TEXT || !text) {
      this.logger.log(`[${tenantId}] Non-text message from ${phone} — skipping`);
      return;
    }

    await this.processIncomingText(tenantId, phone, text, externalId);
  }

  private async processIncomingText(
    tenantId: string,
    phone: string,
    text: string,
    externalMessageId: string,
  ): Promise<void> {
    // ── Step 1: Deduplicate ──────────────────────────────────────
    const existing = await this.prisma.whatsAppMessage.findFirst({
      where: { externalMessageId },
    });
    if (existing) {
      this.logger.debug(`Duplicate message skipped: ${externalMessageId}`);
      return;
    }

    // ── Step 2: Find or create customer ─────────────────────────
    const customer = await this.findOrCreateCustomer(tenantId, phone);

    // ── Step 3: Find or create conversation (Phase 2) ───────────
    const { conversation, session, isNew } =
      await this.conversationsService.findOrCreateConversation(
        tenantId,
        customer.id,
        phone,
      );

    this.logger.log(
      `[${tenantId}] ${isNew ? 'New' : 'Resumed'} conversation ${conversation.id} for ${phone}`,
    );

    // ── Step 4: Store the message in DB ─────────────────────────
    const message = await this.prisma.whatsAppMessage.create({
      data: {
        id: uuidv4(),
        tenantId,
        customerId: customer.id,
        phone,
        messageText: text,
        direction: MessageDirection.INBOUND,
        messageType: MessageType.TEXT,
        status: MessageStatus.RECEIVED,
        externalMessageId,
        conversationId: conversation.id,
      },
    });

    // ── Step 5: Append to conversation history ───────────────────
    await this.conversationsService.addCustomerMessage(tenantId, phone, text);

    // ── Step 6: Get tenant config for AI processing ─────────────
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
    });
    if (!tenant) return;

    // ── Step 7: Get full conversation history for multi-turn AI ──
    // Include previous messages (excluding the one just added) for context
    const conversationHistory = session.messageHistory;

    // ── Step 8: Run AI pipeline with conversation context ────────
    const result = await this.aiEngine.processMessage({
      tenantId,
      customerId: customer.id,
      messageId: message.id,
      messageText: text,
      conversationHistory, // Phase 2: pass history for multi-turn extraction
      autoApproveEnabled: tenant.autoApproveEnabled,
      autoApproveThreshold: tenant.autoApproveThreshold,
      aiConfidenceThreshold: tenant.aiConfidenceThreshold,
    });

    // ── Step 9: Update conversation state after extraction ───────
    if (result.intent === 'ORDER') {
      await this.conversationsService.updateAfterExtraction(
        tenantId,
        phone,
        {}, // partialOrderData — could be enriched with extracted items in future
        result.missingFields,
      );
    }

    // ── Step 10: Send reply and update conversation ──────────────
    if (result.followUpQuestion) {
      // Missing fields — ask follow-up, stay in COLLECTING_DETAILS
      await this.whatsappAdapter.sendTextMessage(phone, result.followUpQuestion);
      await this.conversationsService.addBotReply(tenantId, phone, result.followUpQuestion);

      this.logger.log(`[${tenantId}] Follow-up sent for ${phone}: "${result.followUpQuestion}"`);
    } else if (result.draftOrderId) {
      // Draft order created — complete the conversation
      await this.conversationsService.completeConversation(tenantId, phone);

      const confirmMsg = `✅ Your order has been received and is pending review by the store owner. You'll be notified once it's confirmed!`;
      await this.whatsappAdapter.sendTextMessage(phone, confirmMsg);

      this.logger.log(
        `[${tenantId}] Draft order ${result.draftOrderId} created — conversation completed`,
      );
    }

    this.logger.log(
      `[${tenantId}] AI processing complete: ${result.routing} (confidence: ${(result.overallConfidence * 100).toFixed(1)}%)`,
    );
  }

  private async findOrCreateCustomer(tenantId: string, phone: string) {
    const existing = await this.prisma.customer.findUnique({
      where: { tenantId_phone: { tenantId, phone } },
    });

    if (existing) return existing;

    return this.prisma.customer.create({
      data: {
        id: uuidv4(),
        tenantId,
        phone,
        name: `Customer ${phone.slice(-4)}`, // Placeholder name
      },
    });
  }

  private getMessageType(type: string): MessageType {
    const types: Record<string, MessageType> = {
      text: MessageType.TEXT,
      image: MessageType.IMAGE,
      audio: MessageType.AUDIO,
      video: MessageType.VIDEO,
      document: MessageType.DOCUMENT,
      sticker: MessageType.STICKER,
      location: MessageType.LOCATION,
    };
    return types[type] ?? MessageType.TEXT;
  }
}
