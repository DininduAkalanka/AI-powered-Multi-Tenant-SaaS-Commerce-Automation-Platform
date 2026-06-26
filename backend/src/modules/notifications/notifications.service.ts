import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

export interface EmailOptions {
  to: string;
  subject: string;
  html: string;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private transporter: nodemailer.Transporter;
  private emailFrom: string;

  constructor(private readonly configService: ConfigService) {
    const provider = this.configService.get<string>('EMAIL_PROVIDER', 'mailhog');
    
    // Setup transporter based on provider
    if (provider === 'mailhog') {
      this.transporter = nodemailer.createTransport({
        host: this.configService.get<string>('SMTP_HOST', 'localhost'),
        port: this.configService.get<number>('SMTP_PORT', 1025),
        secure: this.configService.get<boolean>('SMTP_SECURE', false),
        ignoreTLS: true,
      });
    } else {
      // Setup real SMTP or Resend logic here later
      this.logger.warn(`Email provider '${provider}' not fully implemented, falling back to MailHog config`);
      this.transporter = nodemailer.createTransport({
        host: this.configService.get<string>('SMTP_HOST'),
        port: this.configService.get<number>('SMTP_PORT'),
        secure: this.configService.get<boolean>('SMTP_SECURE', false),
        auth: {
          user: this.configService.get<string>('SMTP_USER'),
          pass: this.configService.get<string>('SMTP_PASS'),
        },
      });
    }

    const fromName = this.configService.get<string>('EMAIL_FROM_NAME', 'CommercePilot');
    const fromEmail = this.configService.get<string>('EMAIL_FROM', 'noreply@commercepilot.dev');
    this.emailFrom = `"${fromName}" <${fromEmail}>`;
  }

  async sendEmail(options: EmailOptions): Promise<boolean> {
    try {
      const info = await this.transporter.sendMail({
        from: this.emailFrom,
        to: options.to,
        subject: options.subject,
        html: options.html,
      });

      this.logger.log(`Email sent to ${options.to}: ${info.messageId}`);
      return true;
    } catch (error) {
      this.logger.error(`Failed to send email to ${options.to}`, error);
      return false;
    }
  }

  async sendOrderPendingApprovalEmail(ownerEmail: string, orderNumber: string, dashboardUrl: string) {
    const html = `
      <h2>Action Required: Order Pending Approval</h2>
      <p>A new order (<strong>${orderNumber}</strong>) has been processed by CommercePilot AI and requires your approval.</p>
      <p>Please review and approve the order to finalize processing.</p>
      <a href="${dashboardUrl}" style="display: inline-block; padding: 10px 20px; background-color: #00d084; color: #fff; text-decoration: none; border-radius: 5px;">Review Order</a>
    `;

    return this.sendEmail({
      to: ownerEmail,
      subject: `Action Required: Order ${orderNumber} Pending Approval`,
      html,
    });
  }

  async sendStockAlertEmail(ownerEmail: string, productName: string, available: number, requested: number) {
    const html = `
      <h2>Stock Alert: Insufficient Inventory</h2>
      <p>An order could not be approved due to insufficient stock for <strong>${productName}</strong>.</p>
      <ul>
        <li>Available Stock: ${available}</li>
        <li>Requested Quantity: ${requested}</li>
      </ul>
      <p>Please restock the item or contact the customer to resolve the conflict.</p>
    `;

    return this.sendEmail({
      to: ownerEmail,
      subject: `Stock Alert: Insufficient Inventory for ${productName}`,
      html,
    });
  }
}
