import {
  Controller,
  Get,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentTenant } from '../../common/decorators/current-tenant.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { OrdersService } from './orders.service';
import type { JwtPayload } from '../auth/interfaces/jwt-payload.interface';
import { UserRole, OrderStatus } from '@prisma/client';
import { IsOptional, IsString } from 'class-validator';

class ApproveOrderDto {
  @IsOptional()
  @IsString()
  notes?: string;
}

class RejectOrderDto {
  @IsString()
  reason: string;
}

/**
 * OrdersController
 *
 * All routes require authentication.
 * Approval/rejection requires OWNER role.
 */
@Controller('orders')
@UseGuards(JwtAuthGuard, RolesGuard)
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  /** Dashboard KPI stats */
  @Get('stats')
  async getStats(@CurrentTenant() tenantId: string) {
    const stats = await this.ordersService.getDashboardStats(tenantId);
    return { success: true, data: stats };
  }

  /** Pending AI draft orders awaiting owner approval */
  @Get('drafts')
  async getPendingDrafts(@CurrentTenant() tenantId: string) {
    const drafts = await this.ordersService.getPendingDrafts(tenantId);
    return { success: true, data: drafts };
  }

  /** Get a specific draft with AI processing logs */
  @Get('drafts/:id')
  async getDraft(
    @CurrentTenant() tenantId: string,
    @Param('id') id: string,
  ) {
    const result = await this.ordersService.getDraftById(tenantId, id);
    return { success: true, data: result };
  }

  /** Approve a draft order — OWNER only */
  @Patch('drafts/:id/approve')
  @Roles(UserRole.OWNER)
  @HttpCode(HttpStatus.OK)
  async approveDraft(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: ApproveOrderDto,
  ) {
    const order = await this.ordersService.approveDraft(
      tenantId,
      id,
      user.sub,
      dto.notes,
    );
    return { success: true, message: 'Order approved', data: order };
  }

  /** Reject a draft order — OWNER only */
  @Patch('drafts/:id/reject')
  @Roles(UserRole.OWNER)
  @HttpCode(HttpStatus.OK)
  async rejectDraft(
    @CurrentTenant() tenantId: string,
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body() dto: RejectOrderDto,
  ) {
    const result = await this.ordersService.rejectDraft(
      tenantId,
      id,
      user.sub,
      dto.reason,
    );
    return { success: true, message: 'Order rejected', data: result };
  }

  /** Get all confirmed orders with pagination */
  @Get()
  async getOrders(
    @CurrentTenant() tenantId: string,
    @Query('status') status?: OrderStatus,
    @Query('page') page?: number,
    @Query('limit') limit?: number,
  ) {
    const result = await this.ordersService.getOrders(tenantId, {
      status,
      page,
      limit,
    });
    return { success: true, data: result };
  }
}
