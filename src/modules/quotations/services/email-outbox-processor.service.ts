import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EmailOutboxRepository } from '../repositories/email-outbox.repository';
import { QuotationRepository } from '../repositories/quotation.repository';
import { PdfGeneratorService } from './pdf-generator.service';
import { EmailOutboxDocument } from '../schemas/email-outbox.schema';
import * as nodemailer from 'nodemailer';
import { randomUUID } from 'crypto';

@Injectable()
export class EmailOutboxProcessorService implements OnModuleInit {
  private readonly logger = new Logger(EmailOutboxProcessorService.name);
  private transporter: nodemailer.Transporter | null = null;
  private readonly maxRetries = 5;

  constructor(
    private readonly configService: ConfigService,
    private readonly outboxRepository: EmailOutboxRepository,
    private readonly quotationRepository: QuotationRepository,
    private readonly pdfGeneratorService: PdfGeneratorService,
  ) {}

  onModuleInit() {
    this.initTransporter();
  }

  private initTransporter() {
    const host = this.configService.get<string>('SMTP_HOST') || process.env.SMTP_HOST;
    const port = Number(this.configService.get<number>('SMTP_PORT') || process.env.SMTP_PORT || 587);
    const user = this.configService.get<string>('SMTP_USER') || process.env.SMTP_USER;
    const pass = this.configService.get<string>('SMTP_PASS') || process.env.SMTP_PASS;

    if (host && user) {
      this.transporter = nodemailer.createTransport({
        host,
        port,
        secure: port === 465,
        auth: { user, pass },
      });
      this.logger.log(`EmailOutboxProcessor initialized with SMTP host: ${host}:${port}`);
    } else {
      // In dev or test environments without SMTP credentials, use jsonTransport/stream fallback
      this.transporter = nodemailer.createTransport({
        jsonTransport: true,
      });
      this.logger.log('EmailOutboxProcessor initialized with JSON fallback transporter');
    }
  }

  async processPendingOutbox(batchSize: number = 10): Promise<number> {
    const lockOwner = `worker-${process.pid}-${randomUUID().slice(0, 8)}`;
    const lockDurationMs = 60000; // 60 seconds

    const claimedRecords = await this.outboxRepository.claimPendingBatch(
      batchSize,
      lockOwner,
      lockDurationMs,
    );

    if (!claimedRecords || claimedRecords.length === 0) {
      return 0;
    }

    this.logger.log(`Claimed ${claimedRecords.length} outbox email(s) with worker ID ${lockOwner}`);

    let processedCount = 0;
    for (const record of claimedRecords) {
      try {
        await this.processSingleRecord(record);
        processedCount++;
      } catch (err: any) {
        this.logger.error(`Error processing outbox record ${record._id}: ${err.message}`, err.stack);
      }
    }

    return processedCount;
  }

  private async processSingleRecord(record: EmailOutboxDocument): Promise<void> {
    try {
      const attachments: any[] = [];

      // If tied to a quotation, generate PDF attachment
      if (record.quotationId) {
        const quotation = await this.quotationRepository.findById(
          record.companyId,
          record.quotationId,
        );
        if (quotation) {
          const pdfBuffer = await this.pdfGeneratorService.generatePdfBuffer(quotation);
          attachments.push({
            filename: `${quotation.quoteNumber || 'quotation'}.pdf`,
            content: pdfBuffer,
            contentType: 'application/pdf',
          });
        }
      }

      const fromAddress =
        this.configService.get<string>('SMTP_FROM') ||
        process.env.SMTP_FROM ||
        'no-reply@crm-hrms.local';

      const mailOptions: nodemailer.SendMailOptions = {
        from: fromAddress,
        to: record.recipientEmail,
        subject: record.subject,
        html: record.htmlBody || `<p>${record.subject}</p>`,
        attachments,
      };

      const sendResult = await this.transporter!.sendMail(mailOptions);
      const messageId = sendResult?.messageId || `msg-${randomUUID()}`;

      await this.outboxRepository.markSent(record._id, messageId);
      this.logger.log(
        `Successfully sent email outbox [${record._id}] to ${record.recipientEmail} (msgId: ${messageId})`,
      );
    } catch (err: any) {
      const errorMessage = err?.message || 'Unknown SMTP error';
      const isPermanent =
        record.retryCount + 1 >= this.maxRetries ||
        errorMessage.includes('Invalid login') ||
        errorMessage.includes('No recipients defined');

      // Exponential backoff: 2^(retryCount + 1) * 60 seconds
      const backoffDelayMs = Math.min(
        Math.pow(2, record.retryCount + 1) * 60 * 1000,
        24 * 60 * 60 * 1000, // max 24 hours
      );
      const nextRetryAt = new Date(Date.now() + backoffDelayMs);

      await this.outboxRepository.markFailed(record._id, errorMessage, isPermanent, nextRetryAt);
      this.logger.warn(
        `Failed email outbox [${record._id}] to ${record.recipientEmail}: ${errorMessage}. Permanent: ${isPermanent}`,
      );
    }
  }
}
