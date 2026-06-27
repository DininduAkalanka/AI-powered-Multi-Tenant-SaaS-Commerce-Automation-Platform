import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { OnEvent, EventEmitter2 } from '@nestjs/event-emitter';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '../../common/database/prisma.service';
import {
  OrderStatus,
  AIDraftStatus,
  OrderSource,
  InventoryTxType,
} from '@prisma/client';

/**
 * OrdersService
 *
 * Manages the order lifecycle:
 * WAITING_APPROVAL → APPROVED → SYNCED
 *                 ↘ REJECTED
 *
 * Architecture Rule: No WooCommerce calls here.
 * Integration is handled by IntegrationsModule via interface.
 */
@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * Get all draft orders pending owner approval.
   */
  async getPendingDrafts(tenantId: string) {
    return this.prisma.aIDraftOrder.findMany({
      where: {
        tenantId,
        status: AIDraftStatus.PENDING,
        deletedAt: null,
      },
      include: {
        customer: true,
        items: { include: { product: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Get a specific draft order with full AI extraction details.
   */
  async getDraftById(tenantId: string, draftId: string) {
    const draft = await this.prisma.aIDraftOrder.findFirst({
      where: { id: draftId, tenantId, deletedAt: null },
      include: {
        customer: true,
        items: { include: { product: true } },
      },
    });

    if (!draft) {
      throw new NotFoundException(`Draft order ${draftId} not found`);
    }

    // Also fetch the AI processing logs for this order's message
    const aiLogs = draft.messageId
      ? await this.prisma.aIProcessingLog.findMany({
          where: { tenantId, messageId: draft.messageId },
          orderBy: { createdAt: 'asc' },
        })
      : [];

    return { draft, aiLogs };
  }

  /**
   * Approve a draft order.
   * Creates an official Order record.
   * WooCommerce sync is triggered via event (IntegrationsModule).
   */
  async approveDraft(
    tenantId: string,
    draftId: string,
    reviewerUserId: string,
    notes?: string,
  ) {
    const draft = await this.prisma.aIDraftOrder.findFirst({
      where: { id: draftId, tenantId, status: AIDraftStatus.PENDING },
      include: { items: true },
    });

    if (!draft) {
      throw new NotFoundException(`Draft order ${draftId} not found or already reviewed`);
    }

    // Validate stock for all items
    await this.validateStock(tenantId, draft.items);

    // Create the official order + items in a transaction
    const orderId = uuidv4();
    const structuredData = draft.structuredData as any;

    const order = await this.prisma.$transaction(async (tx) => {
      // Create the Order
      const order = await tx.order.create({
        data: {
          id: orderId,
          tenantId,
          customerId: draft.customerId,
          orderNumber: await this.generateOrderNumber(tenantId),
          status: OrderStatus.APPROVED,
          aiConfidenceScore: draft.overallConfidence,
          source: OrderSource.WHATSAPP,
          deliveryAddress: structuredData?.delivery_info?.address,
          requestedDate: structuredData?.delivery_info?.requested_date
            ? new Date(structuredData.delivery_info.requested_date)
            : null,
          notes,
          reviewedByUserId: reviewerUserId,
          reviewedAt: new Date(),
          aiDraftOrderId: draft.id,
          items: {
            create: draft.items.map((item) => ({
              id: uuidv4(),
              tenantId,
              productId: item.productId!,
              quantity: item.quantity,
              unitPrice: item.unitPrice ?? 0,
              subtotal: Number(item.unitPrice ?? 0) * item.quantity,
              selectedAttributes: item.selectedAttributes as object,
            })),
          },
        },
        include: { items: true, customer: true },
      });

      // Update draft status
      await tx.aIDraftOrder.update({
        where: { id: draftId },
        data: { status: AIDraftStatus.APPROVED },
      });

      // Update customer order count
      await tx.customer.update({
        where: { id: draft.customerId },
        data: { totalOrders: { increment: 1 } },
      });

      // Create inventory transactions (deduct stock)
      for (const item of draft.items) {
        if (item.productId) {
          await tx.inventoryTransaction.create({
            data: {
              id: uuidv4(),
              tenantId,
              productId: item.productId,
              type: InventoryTxType.OUT,
              quantity: -item.quantity,
              referenceOrderId: orderId,
              notes: `Order ${order.orderNumber} approved`,
            },
          });

          // Reduce stock
          await tx.product.update({
            where: { id: item.productId },
            data: { stockQuantity: { decrement: item.quantity } },
          });
        }
      }

      // Audit log
      await tx.auditLog.create({
        data: {
          id: uuidv4(),
          tenantId,
          actorUserId: reviewerUserId,
          actorType: 'USER',
          action: 'ORDER_APPROVED',
          entityType: 'Order',
          entityId: orderId,
          afterState: { orderId, status: 'APPROVED', draftId },
        },
      });

      return order;
    });

    this.logger.log(`[${tenantId}] Order approved: ${order.orderNumber} (${orderId})`);

    // Emit event so IntegrationsModule can sync to WooCommerce
    this.eventEmitter.emit('order.approved', { tenantId, orderId });

    return order;
  }

  /**
   * Reject a draft order with a reason.
   */
  async rejectDraft(
    tenantId: string,
    draftId: string,
    reviewerUserId: string,
    reason: string,
  ) {
    const draft = await this.prisma.aIDraftOrder.findFirst({
      where: { id: draftId, tenantId, status: AIDraftStatus.PENDING },
    });

    if (!draft) {
      throw new NotFoundException(`Draft order ${draftId} not found or already reviewed`);
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.aIDraftOrder.update({
        where: { id: draftId },
        data: { status: AIDraftStatus.REJECTED },
      });

      await tx.auditLog.create({
        data: {
          id: uuidv4(),
          tenantId,
          actorUserId: reviewerUserId,
          actorType: 'USER',
          action: 'ORDER_REJECTED',
          entityType: 'AIDraftOrder',
          entityId: draftId,
          afterState: { draftId, status: 'REJECTED', reason },
        },
      });
    });

    this.logger.log(`[${tenantId}] Draft order rejected: ${draftId}`);

    return { success: true, message: 'Order rejected' };
  }

  /**
   * Get all confirmed orders with filtering.
   */
  async getOrders(
    tenantId: string,
    filters: { status?: OrderStatus; page?: number; limit?: number },
  ) {
    const { status, page = 1, limit = 20 } = filters;
    const skip = (page - 1) * limit;

    const [orders, total] = await Promise.all([
      this.prisma.order.findMany({
        where: { tenantId, status, deletedAt: null },
        include: {
          customer: true,
          items: { include: { product: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.order.count({
        where: { tenantId, status, deletedAt: null },
      }),
    ]);

    return { orders, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  /**
   * Dashboard stats — today's KPIs.
   */
  async getDashboardStats(tenantId: string) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [
      totalOrders,
      pendingApproval,
      approvedToday,
      rejectedToday,
    ] = await Promise.all([
      this.prisma.order.count({ where: { tenantId, deletedAt: null } }),
      this.prisma.aIDraftOrder.count({
        where: { tenantId, status: AIDraftStatus.PENDING },
      }),
      this.prisma.order.count({
        where: {
          tenantId,
          status: { in: [OrderStatus.APPROVED, OrderStatus.SYNCED] },
          createdAt: { gte: today },
        },
      }),
      this.prisma.aIDraftOrder.count({
        where: {
          tenantId,
          status: AIDraftStatus.REJECTED,
          createdAt: { gte: today },
        },
      }),
    ]);

    return { totalOrders, pendingApproval, approvedToday, rejectedToday };
  }

  // ── Private helpers ────────────────────────────────────────────

  private async validateStock(
    tenantId: string,
    items: Array<{ productId: string | null; quantity: number }>,
  ): Promise<void> {
    for (const item of items) {
      if (!item.productId) continue;

      const product = await this.prisma.product.findFirst({
        where: { id: item.productId, tenantId, deletedAt: null },
      });

      if (!product) {
        throw new BadRequestException(`Product not found: ${item.productId}`);
      }

      if (product.stockQuantity < item.quantity) {
        throw new BadRequestException(
          `Insufficient stock for "${product.name}". ` +
            `Available: ${product.stockQuantity}, Requested: ${item.quantity}`,
        );
      }
    }
  }

  private async generateOrderNumber(tenantId: string): Promise<string> {
    const count = await this.prisma.order.count({ where: { tenantId } });
    const year = new Date().getFullYear();
    return `ORD-${year}-${String(count + 1).padStart(4, '0')}`;
  }

  /**
   * Record owner corrections to an AI draft order.
   *
   * Phase 2 — AI Correction Logging (training signal).
   * Stores the diff between what the AI extracted and what the owner corrected.
   * This data is used for future model fine-tuning and evaluation.
   *
   * Architecture Rule: This is the only method that writes to humanCorrections.
   * The AuditLog record is immutable.
   */
  async saveDraftCorrections(
    tenantId: string,
    draftId: string,
    correctedData: Record<string, unknown>,
    userId: string,
  ): Promise<void> {
    const draft = await this.prisma.aIDraftOrder.findFirst({
      where: { id: draftId, tenantId, deletedAt: null },
    });

    if (!draft) {
      throw new NotFoundException(`Draft order not found: ${draftId}`);
    }

    if (draft.status !== AIDraftStatus.PENDING && draft.status !== AIDraftStatus.REVIEWED) {
      throw new BadRequestException(
        `Cannot correct a draft in status: ${draft.status}. Only PENDING or REVIEWED drafts can be corrected.`,
      );
    }

    // Build correction diff: compare original AI extraction vs. owner's corrections
    const originalData = draft.structuredData as Record<string, unknown>;
    const fieldsCorrected = this.computeCorrectedFields(originalData, correctedData);

    const corrections = {
      originalAiExtraction: originalData,
      ownerCorrections: correctedData,
      fieldsCorrected,
      correctedAt: new Date().toISOString(),
    };

    // Update the draft with corrections
    await this.prisma.aIDraftOrder.update({
      where: { id: draftId },
      data: {
        humanCorrections: corrections as object,
        correctedByUserId: userId,
        correctedAt: new Date(),
        status: AIDraftStatus.REVIEWED,
        structuredData: correctedData as object, // Update the working copy with owner's version
      },
    });

    // Write immutable audit log (architecture rule: audit logs are never updated/deleted)
    await this.prisma.auditLog.create({
      data: {
        id: uuidv4(),
        tenantId,
        actorUserId: userId,
        actorType: 'USER',
        action: 'AI_CORRECTION_RECORDED',
        entityType: 'AIDraftOrder',
        entityId: draftId,
        beforeState: { structuredData: originalData } as object,
        afterState: { structuredData: correctedData, fieldsCorrected } as object,
      },
    });

    this.logger.log(
      `[${tenantId}] Draft ${draftId} corrected by user ${userId}. Fields changed: ${fieldsCorrected.join(', ') || 'none'}`,
    );
  }

  /**
   * Compute a flat list of field paths that differ between original and corrected data.
   * Provides a quick summary of what the owner changed (e.g. ["items[0].quantity", "delivery_info.address"]).
   */
  private computeCorrectedFields(
    original: Record<string, unknown>,
    corrected: Record<string, unknown>,
  ): string[] {
    const changed: string[] = [];

    const compare = (orig: unknown, corr: unknown, path: string) => {
      if (JSON.stringify(orig) !== JSON.stringify(corr)) {
        changed.push(path);
      }
    };

    // Top-level keys
    const allKeys = new Set([...Object.keys(original), ...Object.keys(corrected)]);
    for (const key of allKeys) {
      compare(original[key], corrected[key], key);
    }

    return changed;
  }

  /**
   * Listen for auto-approval events from AiEngineService.
   * Phase 2 — Confidence-Based Auto-Routing
   */
  @OnEvent('draft.auto_approve')
  async handleAutoApproveEvent(payload: { tenantId: string; draftId: string }) {
    this.logger.log(`[${payload.tenantId}] Auto-approving draft order ${payload.draftId}`);
    try {
      // We use 'SYSTEM' as the reviewerUserId to indicate AI auto-approval
      await this.approveDraft(payload.tenantId, payload.draftId, 'SYSTEM');
    } catch (error) {
      this.logger.error(`[${payload.tenantId}] Auto-approve failed for draft ${payload.draftId}: ${error.message}`);
    }
  }
}

