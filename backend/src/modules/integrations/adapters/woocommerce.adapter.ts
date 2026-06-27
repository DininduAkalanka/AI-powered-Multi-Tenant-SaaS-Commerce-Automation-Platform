import { Injectable, Logger } from '@nestjs/common';
import WooCommerceRestApi from '@woocommerce/woocommerce-rest-api';
import {
  IEcommerceAdapter,
  SyncProduct,
  CreateOrderPayload,
  CreateOrderResult,
} from '../interfaces/ecommerce-adapter.interface';
import { PrismaService } from '../../../common/database/prisma.service';
import { EcommerceProvider } from '@prisma/client';

@Injectable()
export class WooCommerceAdapter implements IEcommerceAdapter {
  private readonly logger = new Logger(WooCommerceAdapter.name);
  private api: any = null; // Instance of WooCommerceRestApi
  private isMock = false;

  constructor(private readonly prisma: PrismaService) {}

  async initialize(tenantId: string): Promise<void> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        woocommerceProvider: true,
        woocommerceUrl: true,
        woocommerceKey: true,
        woocommerceSecret: true,
      },
    });

    if (!tenant) {
      throw new Error(`Tenant ${tenantId} not found`);
    }

    if (tenant.woocommerceProvider === EcommerceProvider.MOCK) {
      this.isMock = true;
      this.logger.log(`Initialized in MOCK mode for tenant ${tenantId}`);
      return;
    }

    if (!tenant.woocommerceUrl || !tenant.woocommerceKey || !tenant.woocommerceSecret) {
      throw new Error(`WooCommerce credentials missing for tenant ${tenantId}`);
    }

    this.isMock = false;
    
    // WooCommerceRestApi uses default export or named, depending on version
    // Usually it's a class: new WooCommerceRestApi(...)
    const ApiClass = (WooCommerceRestApi as any).default || WooCommerceRestApi;
    this.api = new ApiClass({
      url: tenant.woocommerceUrl,
      consumerKey: tenant.woocommerceKey,
      consumerSecret: tenant.woocommerceSecret,
      version: 'wc/v3',
    });

    this.logger.log(`Initialized WooCommerce API for tenant ${tenantId}`);
  }

  async getProducts(): Promise<SyncProduct[]> {
    if (this.isMock) {
      return this.getMockProducts();
    }

    if (!this.api) {
      throw new Error('Adapter not initialized');
    }

    try {
      // Fetching up to 100 products for simplicity. 
      // In production, this would handle pagination.
      const response = await this.api.get('products', { per_page: 100 });
      const wcProducts = response.data;

      return wcProducts.map((p: any) => ({
        externalId: String(p.id),
        name: p.name,
        description: p.short_description || p.description,
        price: parseFloat(p.price || p.regular_price || '0'),
        stockQuantity: p.stock_quantity ?? 100, // default if not managing stock
        isActive: p.status === 'publish',
        categories: p.categories?.map((c: any) => c.name) || [],
        attributes: p.attributes?.reduce((acc: any, attr: any) => {
          acc[attr.name] = attr.options;
          return acc;
        }, {}) || {},
        imageUrl: p.images?.[0]?.src,
      }));
    } catch (error: any) {
      this.logger.error(`Failed to fetch WooCommerce products: ${error.message}`);
      throw error;
    }
  }

  async createOrder(payload: CreateOrderPayload): Promise<CreateOrderResult> {
    if (this.isMock) {
      this.logger.log(`[MOCK] Creating order ${payload.orderNumber}`);
      return { success: true, externalOrderId: `mock_wc_${Date.now()}` };
    }

    if (!this.api) {
      throw new Error('Adapter not initialized');
    }

    try {
      const data = {
        payment_method: 'bacs',
        payment_method_title: 'Direct Bank Transfer',
        set_paid: false,
        billing: {
          first_name: payload.customerName || 'WhatsApp',
          last_name: 'Customer',
          phone: payload.customerPhone || '',
        },
        line_items: payload.items.map((item) => ({
          product_id: parseInt(item.externalProductId, 10),
          quantity: item.quantity,
        })),
        customer_note: payload.notes || '',
      };

      const response = await this.api.post('orders', data);
      
      this.logger.log(`WooCommerce order created: ${response.data.id}`);
      return { success: true, externalOrderId: String(response.data.id) };
    } catch (error: any) {
      this.logger.error(`Failed to create WooCommerce order: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  private getMockProducts(): SyncProduct[] {
    return [
      {
        externalId: 'mock_1',
        name: 'White School Shirt (Mock)',
        description: 'Standard white uniform shirt',
        price: 1500,
        stockQuantity: 50,
        isActive: true,
        categories: ['Uniforms'],
        attributes: { size: ['S', 'M', 'L'], color: ['white'] },
      },
      {
        externalId: 'mock_2',
        name: 'Blue School Trousers (Mock)',
        description: 'Standard blue uniform trousers',
        price: 2500,
        stockQuantity: 30,
        isActive: true,
        categories: ['Uniforms'],
        attributes: { size: ['28', '30', '32'], color: ['blue'] },
      },
    ];
  }
}
