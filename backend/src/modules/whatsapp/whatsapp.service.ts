import { Injectable, Logger, Inject } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '../../common/database/prisma.service';
import { AiEngineService } from '../ai-engine/ai-engine.service';
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
 * 4. Triggering AI processing
 * 5. Sending replies
 */
@Injectable()
export class WhatsAppService {
  private readonly logger = new Logger(WhatsAppService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly aiEngine: AiEngineService,
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
      // if (!isValid) throw new ForbiddenException('Invalid webhook signature');

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
    // Deduplicate: skip if already processed
    const existing = await this.prisma.whatsAppMessage.findFirst({
      where: { externalMessageId },
    });
    if (existing) {
      this.logger.debug(`Duplicate message skipped: ${externalMessageId}`);
      return;
    }

    // Find or create customer
    const customer = await this.findOrCreateCustomer(tenantId, phone);

    // Store the message
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
      },
    });

    this.logger.log(`[${tenantId}] Message stored: ${message.id} from ${phone}`);

    // Get tenant config for AI processing
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
    });

    if (!tenant) return;

    // Process through AI pipeline (synchronous for now — BullMQ in Phase 2)
    const result = await this.aiEngine.processMessage({
      tenantId,
      customerId: customer.id,
      messageId: message.id,
      messageText: text,
      autoApproveEnabled: tenant.autoApproveEnabled,
      autoApproveThreshold: tenant.autoApproveThreshold,
      aiConfidenceThreshold: tenant.aiConfidenceThreshold,
    });

    // Send follow-up question if order is incomplete
    if (result.followUpQuestion) {
      await this.whatsappAdapter.sendTextMessage(phone, result.followUpQuestion);
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
