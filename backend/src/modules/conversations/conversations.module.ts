import { Module } from '@nestjs/common';
import { ConversationsService } from './conversations.service';
import { ConversationStateService } from './conversation-state.service';
import { IoRedisAdapter } from './adapters/ioredis.adapter';
import { REDIS_SERVICE } from './interfaces/redis-service.interface';

/**
 * ConversationsModule
 *
 * Provides multi-turn conversation state management backed by Redis + PostgreSQL.
 *
 * Exports ConversationsService so the WhatsAppModule can use it
 * without directly accessing the Conversation table (Clean Architecture rule:
 * "No module may directly access another module's database tables").
 */
@Module({
  providers: [
    // Bind the IRedisService token to the concrete IoRedisAdapter
    {
      provide: REDIS_SERVICE,
      useClass: IoRedisAdapter,
    },
    ConversationStateService,
    ConversationsService,
  ],
  exports: [ConversationsService, ConversationStateService],
})
export class ConversationsModule {}
