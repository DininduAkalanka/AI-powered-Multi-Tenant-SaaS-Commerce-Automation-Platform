import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WhatsAppController } from './whatsapp.controller';
import { WhatsAppService } from './whatsapp.service';
import { MockWhatsAppAdapter } from './adapters/mock-whatsapp.adapter';
import { WHATSAPP_ADAPTER } from './interfaces/whatsapp-adapter.interface';
import { AiEngineModule } from '../ai-engine/ai-engine.module';
import { ConversationsModule } from '../conversations/conversations.module';

@Module({
  imports: [AiEngineModule, ConversationsModule],
  controllers: [WhatsAppController],
  providers: [
    WhatsAppService,
    // Dynamic adapter selection based on WHATSAPP_PROVIDER env var
    {
      provide: WHATSAPP_ADAPTER,
      useFactory: (configService: ConfigService) => {
        const provider = configService.get<string>('WHATSAPP_PROVIDER', 'mock');
        if (provider === 'meta') {
          // TODO: return MetaCloudWhatsAppAdapter when WHATSAPP_PROVIDER=meta
          // For now, always use mock
        }
        return new MockWhatsAppAdapter();
      },
      inject: [ConfigService],
    },
  ],
  exports: [WhatsAppService, WHATSAPP_ADAPTER],
})
export class WhatsAppModule {}
