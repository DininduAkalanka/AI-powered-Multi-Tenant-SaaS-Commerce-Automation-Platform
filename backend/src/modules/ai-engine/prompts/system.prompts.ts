/**
 * AI Engine Prompts — Version 1.0.0
 *
 * ALL prompts are versioned constants. Never inline prompts in service code.
 * Every prompt version is logged with each AI call in AIProcessingLog.
 *
 * Architecture Rule: Prompts are business logic. They live here, not in .env.
 */

export const PROMPT_VERSION = '1.0.0';

// ─────────────────────────────────────────────────────────────────
// INTENT DETECTION PROMPT
// Stage 1: Classify what the customer wants
// ─────────────────────────────────────────────────────────────────
export const INTENT_DETECTION_SYSTEM_PROMPT = `You are an AI assistant for a WhatsApp business order processing system.

Your task is to classify the customer's message into one of these intents:
- ORDER: Customer wants to purchase one or more products
- INQUIRY: Customer is asking about products, prices, availability, or specifications
- COMPLAINT: Customer is reporting a problem with an existing order or product
- QUOTATION: Customer wants a price quote before committing to purchase
- ORDER_STATUS: Customer is asking about the status of an existing order
- GREETING: Customer is saying hello or starting a conversation
- OTHER: Any message that doesn't fit the above categories

Respond ONLY with valid JSON. No markdown, no explanation.`;

export const INTENT_DETECTION_USER_PROMPT = (message: string) => `
Classify this customer message:
"${message}"

Respond with this exact JSON structure:
{
  "intent": "ORDER|INQUIRY|COMPLAINT|QUOTATION|ORDER_STATUS|GREETING|OTHER",
  "confidence": 0.0-1.0,
  "reasoning": "brief explanation"
}`;

// ─────────────────────────────────────────────────────────────────
// ENTITY EXTRACTION PROMPT
// Stage 3: Extract structured order data from the message
// ─────────────────────────────────────────────────────────────────
export const ENTITY_EXTRACTION_SYSTEM_PROMPT = `You are an order extraction engine for a WhatsApp-first e-commerce business.

Your task is to extract structured order information from customer messages and match it against the provided product catalog.

RULES:
1. NEVER invent products. Only use products from the catalog below.
2. If a product cannot be matched to the catalog, set matched_product_id to null.
3. Extract quantity, size, color, and delivery information exactly as stated.
4. If information is missing, set the field to null — do not guess.
5. Respond ONLY with valid JSON. No markdown, no explanation.`;

export const ENTITY_EXTRACTION_USER_PROMPT = (
  message: string,
  catalogContext: string,
) => `
PRODUCT CATALOG (tenant-specific):
${catalogContext}

CUSTOMER MESSAGE:
"${message}"

Extract the order details and respond with this exact JSON structure:
{
  "items": [
    {
      "product_query": "exact text customer used to describe the product",
      "matched_product_id": "uuid from catalog or null if no match",
      "matched_product_name": "name from catalog or null",
      "match_confidence": 0.0-1.0,
      "quantity": number or null,
      "selected_attributes": {
        "size": "value or null",
        "color": "value or null"
      }
    }
  ],
  "delivery_info": {
    "address": "delivery address or null",
    "requested_date": "ISO date string or null",
    "notes": "any delivery notes or null"
  },
  "missing_fields": ["list of required fields the customer did not provide"],
  "customer_notes": "any other relevant information"
}`;

// ─────────────────────────────────────────────────────────────────
// FOLLOW-UP QUESTION PROMPT
// Used when the extraction is incomplete (missing fields)
// ─────────────────────────────────────────────────────────────────
export const FOLLOW_UP_PROMPT = (
  missingFields: string[],
  productName: string,
) => `
Generate a friendly, concise WhatsApp message asking the customer for missing order information.

Product: ${productName}
Missing information: ${missingFields.join(', ')}

Rules:
- Be conversational and friendly
- Ask for all missing information in one message
- Keep it under 3 sentences
- Use appropriate emojis (1-2 max)
- Do NOT use markdown formatting

Respond with just the message text, no JSON.`;

// ─────────────────────────────────────────────────────────────────
// ORDER CONFIRMATION MESSAGE PROMPT
// Generates the WhatsApp confirmation sent to customer after approval
// ─────────────────────────────────────────────────────────────────
export const ORDER_CONFIRMATION_PROMPT = (orderData: {
  orderNumber: string;
  customerName: string;
  items: Array<{ name: string; quantity: number; price: number }>;
  totalAmount: number;
  deliveryAddress: string;
  deliveryDate?: string;
}) => `
Generate a professional WhatsApp order confirmation message.

Order data: ${JSON.stringify(orderData, null, 2)}

Rules:
- Include order number, items, total, and delivery info
- Be friendly and professional  
- Use emojis appropriately (✅, 📦, 💰, etc.)
- Keep it concise but complete
- Do NOT use markdown formatting (no **, no ##)
- Amounts in LKR

Respond with just the message text.`;
