import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
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

  constructor(private readonly prisma: PrismaService) {}

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
}
