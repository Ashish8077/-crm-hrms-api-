import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Quotation, QuotationDocument } from '../schemas/quotation.schema';
import { RedisService } from '../../../common/redis/redis.service';
import { EmailOutboxRepository } from '../repositories/email-outbox.repository';
import { QuotationActivityLogRepository } from '../repositories/quotation-activity-log.repository';
import {
  EmailDeliveryStatus,
  QuotationStatus,
} from '../constants/quotation-status.constant';
import { randomUUID } from 'crypto';

@Injectable()
export class QuotationExpiryScheduler {
  private readonly logger = new Logger(QuotationExpiryScheduler.name);
  private readonly lockKey = 'crm:quotations:expiry-scheduler:lock';

  constructor(
    @InjectModel(Quotation.name)
    private readonly quotationModel: Model<QuotationDocument>,
    private readonly redisService: RedisService,
    private readonly emailOutboxRepository: EmailOutboxRepository,
    private readonly activityLogRepository: QuotationActivityLogRepository,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT, { timeZone: 'UTC' })
  async handleQuotationLifecycleJob(): Promise<void> {
    const lockVal = `cron-${process.pid}-${randomUUID().slice(0, 8)}`;
    const lockDurationMs = 300000; // 5 minutes

    const acquired = await this.acquireDistributedLock(this.lockKey, lockVal, lockDurationMs);
    if (!acquired) {
      this.logger.log('Quotation expiry cron lock already held by another instance. Skipping.');
      return;
    }

    try {
      this.logger.log('Starting daily quotation expiry & reminder background run...');
      await this.processAdvanceReminders();
      await this.processExpiredQuotations();
      this.logger.log('Daily quotation expiry & reminder background run completed.');
    } catch (err: any) {
      this.logger.error(`Error in quotation expiry scheduler: ${err.message}`, err.stack);
    } finally {
      await this.releaseDistributedLock(this.lockKey, lockVal);
    }
  }

  private async processAdvanceReminders(): Promise<void> {
    const now = new Date();
    const reminderWindow = new Date(now.getTime() + 48 * 60 * 60 * 1000); // 48 hours ahead

    const quotesNeedingReminder = await this.quotationModel
      .find({
        status: { $in: [QuotationStatus.SENT, QuotationStatus.VIEWED] },
        reminderSentAt: null,
        expiryDate: { $gt: now, $lte: reminderWindow },
        deletedAt: null,
      })
      .populate('contactId', 'firstName lastName email')
      .limit(100)
      .exec();

    this.logger.log(`Found ${quotesNeedingReminder.length} quotation(s) eligible for 48h expiry reminder`);

    for (const quote of quotesNeedingReminder) {
      try {
        const contact = quote.contactId as any;
        const recipientEmail = contact?.email;

        if (recipientEmail) {
          const idempotencyKey = `quote-reminder-${quote._id}-${now.toISOString().split('T')[0]}`;
          const subject = `Reminder: Quotation #${quote.quoteNumber} expires soon`;
          const htmlBody = `
            <p>Dear ${contact.firstName || 'Customer'},</p>
            <p>This is a friendly reminder that quotation <strong>#${quote.quoteNumber}</strong> is set to expire on <strong>${quote.expiryDate.toISOString().split('T')[0]}</strong>.</p>
            <p>Please review and confirm your acceptance before expiration.</p>
          `;

          await this.emailOutboxRepository.createOutboxRecord({
            companyId: quote.companyId,
            quotationId: quote._id,
            recipientEmail,
            subject,
            htmlBody,
            idempotencyKey,
            status: EmailDeliveryStatus.PENDING,
            retryCount: 0,
            nextRetryAt: now,
          });

          await this.quotationModel.updateOne(
            { _id: quote._id },
            { $set: { reminderSentAt: now } },
          );

          await this.activityLogRepository.logActivity(
            quote.companyId,
            quote._id,
            'REMINDER_SENT',
            `48h expiry reminder dispatched to ${recipientEmail}`,
            null,
          );
        }
      } catch (err: any) {
        this.logger.warn(`Could not dispatch reminder for quote ${quote._id}: ${err.message}`);
      }
    }
  }

  private async processExpiredQuotations(): Promise<void> {
    const now = new Date();

    const expiredQuotes = await this.quotationModel
      .find({
        status: { $in: [QuotationStatus.SENT, QuotationStatus.VIEWED] },
        expiryDate: { $lte: now },
        deletedAt: null,
      })
      .limit(200)
      .exec();

    this.logger.log(`Found ${expiredQuotes.length} quotation(s) past expiry date`);

    for (const quote of expiredQuotes) {
      try {
        await this.quotationModel.updateOne(
          { _id: quote._id, status: { $in: [QuotationStatus.SENT, QuotationStatus.VIEWED] } },
          { $set: { status: QuotationStatus.EXPIRED, portalTokenRevoked: true } },
        );

        await this.activityLogRepository.logActivity(
          quote.companyId,
          quote._id,
          'EXPIRED',
          'Quotation marked as expired by automated scheduler',
          null,
        );
      } catch (err: any) {
        this.logger.warn(`Error expiring quote ${quote._id}: ${err.message}`);
      }
    }
  }

  private async acquireDistributedLock(
    key: string,
    val: string,
    ttlMs: number,
  ): Promise<boolean> {
    try {
      const client = this.redisService.getClient();
      const res = await client.set(key, val, 'PX', ttlMs, 'NX');
      return res === 'OK';
    } catch {
      return false;
    }
  }

  private async releaseDistributedLock(key: string, val: string): Promise<void> {
    const script = `
      if redis.call("get", KEYS[1]) == ARGV[1] then
        return redis.call("del", KEYS[1])
      else
        return 0
      end
    `;
    try {
      const client = this.redisService.getClient();
      await client.eval(script, 1, key, val);
    } catch {
      // Ignore cleanup error
    }
  }
}
