import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { DatabaseModule } from './common/database/database.module';
import { AuthModule } from './modules/auth/auth.module';
import { WhatsAppModule } from './modules/whatsapp/whatsapp.module';
import { AiEngineModule } from './modules/ai-engine/ai-engine.module';
import { OrdersModule } from './modules/orders/orders.module';
import { ProductsModule } from './modules/products/products.module';
import { NotificationsModule } from './modules/notifications/notifications.module';

/**
 * AppModule — Root module
 *
 * Wires all application modules together.
 * New modules are added here as they are built.
 */
@Module({
  imports: [
    // ── Configuration ───────────────────────────────────────────
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),

    // ── Rate Limiting ────────────────────────────────────────────
    ThrottlerModule.forRoot([
      { name: 'short', ttl: 1000, limit: 10 },
      { name: 'long', ttl: 60000, limit: 100 },
    ]),

    // ── Database (Global) ─────────────────────────────────────────
    DatabaseModule,

    // ── Phase 0: Auth ─────────────────────────────────────────────
    AuthModule,

    // ── Phase 1: Core MVP ─────────────────────────────────────────
    AiEngineModule,
    WhatsAppModule,
    OrdersModule,
    ProductsModule,
    NotificationsModule,

    // TODO (Phase 2): ConversationsModule
    // TODO (Phase 3): AuditLogsModule
  ],
})
export class AppModule {}
