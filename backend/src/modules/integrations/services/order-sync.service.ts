import { Injectable, Logger, Inject } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../../common/database/prisma.service';
import { ECOMMERCE_ADAPTER } from '../interfaces/ecommerce-adapter.interface';
import type { IEcommerceAdapter, CreateOrderPayload } from '../interfaces/ecommerce-adapter.interface';
import { OrderStatus, NotificationType, NotificationChannel } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class OrderSyncService {
  private readonly logger = new Logger(OrderSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(ECOMMERCE_ADAPTER)
    private readonly adapter: IEcommerceAdapter,
  ) {}

  /**
   * Listen for approved orders and push them to the Ecommerce system.
   */
  @OnEvent('order.approved')
  async handleOrderApproved(payload: { tenantId: string; orderId: string }) {
    const { tenantId, orderId } = payload;
    this.logger.log(`[${tenantId}] Starting sync for approved order ${orderId}`);

    try {
      // 1. Fetch order details from DB
      const order = await this.prisma.order.findUnique({
        where: { id: orderId },
        include: {
          items: {
            include: {
              product: true,
            },
          },
          customer: true,
        },
      });

      if (!order) {
        this.logger.error(`[${tenantId}] Order ${orderId} not found`);
        return;
      }

      // 2. Initialize the adapter
      await this.adapter.initialize(tenantId);

      // 3. Map order to the adapter payload
      const orderPayload: CreateOrderPayload = {
        orderNumber: order.orderNumber,
        customerId: order.customerId,
        customerName: order.customer?.name || 'WhatsApp Customer',
        customerPhone: order.customer?.phone || '',
        items: order.items.map((item) => {
          if (!item.product?.woocommerceId) {
            this.logger.warn(`Item ${item.id} has no WooCommerce ID. It may not sync correctly.`);
          }
          return {
            externalProductId: item.product?.woocommerceId || '',
            quantity: item.quantity,
            price: Number(item.unitPrice),
          };
        }),
        totalAmount: Number(order.totalAmount),
        notes: `Created via CommercePilot (AI Confidence: ${order.aiConfidenceScore})`,
      };

      // 4. Create the order
      const result = await this.adapter.createOrder(orderPayload);

      // 5. Update status
      if (result.success) {
        await this.prisma.$transaction(async (tx) => {
          await tx.order.update({
            where: { id: orderId },
            data: { status: OrderStatus.SYNCED },
          });
          
          await tx.auditLog.create({
            data: {
              id: uuidv4(),
              tenantId,
              actorType: 'SYSTEM',
              action: 'ORDER_SYNCED',
              entityType: 'Order',
              entityId: orderId,
              afterState: { status: 'SYNCED', externalOrderId: result.externalOrderId } as object,
            },
          });
        });
        this.logger.log(`[${tenantId}] Order ${orderId} synced successfully (Ext ID: ${result.externalOrderId})`);
      } else {
        throw new Error(result.error || 'Unknown sync error');
      }

    } catch (error: any) {
      this.logger.error(`[${tenantId}] Failed to sync order ${orderId}: ${error.message}`);
      
      // Update status to FAILED and log audit
      await this.prisma.$transaction(async (tx) => {
        await tx.order.update({
          where: { id: orderId },
          data: { status: OrderStatus.FAILED },
        });

        await tx.auditLog.create({
          data: {
            id: uuidv4(),
            tenantId,
            actorType: 'SYSTEM',
            action: 'ORDER_SYNC_FAILED',
            entityType: 'Order',
            entityId: orderId,
            afterState: { status: 'FAILED', error: error.message } as object,
          },
        });

        // Generate a notification for the owner
        await tx.notification.create({
          data: {
            id: uuidv4(),
            tenantId,
            type: NotificationType.SYSTEM_ALERT,
            channel: NotificationChannel.SYSTEM,
            title: 'Order Sync Failed',
            message: `Failed to sync order to WooCommerce: ${error.message}`,
          },
        });
      });
    }
  }
}
