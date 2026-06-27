export const ECOMMERCE_ADAPTER = Symbol('ECOMMERCE_ADAPTER');

/**
 * Standardized product format returned from an Ecommerce provider.
 */
export interface SyncProduct {
  externalId: string;
  name: string;
  description?: string;
  price: number;
  stockQuantity: number;
  isActive: boolean;
  categories: string[];
  attributes: Record<string, string[]>;
  imageUrl?: string;
}

/**
 * The standard payload we send to an Ecommerce provider to create an order.
 */
export interface CreateOrderPayload {
  orderNumber: string;
  customerId: string;
  customerName?: string;
  customerPhone?: string;
  items: Array<{
    externalProductId: string;
    quantity: number;
    price?: number;
  }>;
  totalAmount?: number;
  notes?: string;
}

/**
 * Standardized response after creating an order.
 */
export interface CreateOrderResult {
  success: boolean;
  externalOrderId?: string;
  error?: string;
}

/**
 * Abstract interface that all Ecommerce providers (WooCommerce, Shopify) must implement.
 */
export interface IEcommerceAdapter {
  /**
   * Initialize the adapter with tenant credentials.
   */
  initialize(tenantId: string): Promise<void>;

  /**
   * Fetch all products from the provider.
   */
  getProducts(): Promise<SyncProduct[]>;

  /**
   * Create an order in the provider's system.
   */
  createOrder(payload: CreateOrderPayload): Promise<CreateOrderResult>;
}
