import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import {
  EmailOutbox,
  EmailOutboxDocument,
} from '../schemas/email-outbox.schema';

export type EmailOutboxLean = EmailOutbox & { _id: Types.ObjectId };

@Injectable()
export class EmailOutboxRepository {
  constructor(
    @InjectModel(EmailOutbox.name)
    private readonly outboxModel: Model<EmailOutboxDocument>,
  ) {}

  async create(
    data: Partial<EmailOutbox>,
    session?: ClientSession,
  ): Promise<EmailOutboxLean> {
    const docs = await this.outboxModel.create([data], { session });
    return docs[0].toObject();
  }

  async createOutboxRecord(
    data: Partial<EmailOutbox>,
    session?: ClientSession,
  ): Promise<EmailOutboxLean> {
    return this.create(data, session);
  }

  async findScopedById(
    id: Types.ObjectId,
    companyId: Types.ObjectId,
  ): Promise<EmailOutboxLean | null> {
    return this.outboxModel
      .findOne({ _id: id, companyId })
      .lean<EmailOutboxLean>()
      .exec();
  }

  async findByQuotationId(
    arg1: Types.ObjectId,
    arg2: Types.ObjectId,
  ): Promise<EmailOutboxLean[]> {
    return this.outboxModel
      .find({
        $or: [
          { quotationId: arg1, companyId: arg2 },
          { quotationId: arg2, companyId: arg1 },
        ],
      })
      .sort({ createdAt: -1 })
      .lean<EmailOutboxLean[]>()
      .exec();
  }

  async claimPendingRecord(
    workerInstanceId: string,
  ): Promise<EmailOutboxLean | null> {
    return this.outboxModel
      .findOneAndUpdate(
        {
          status: 'PENDING',
          nextRetryAt: { $lte: new Date() },
        },
        {
          $set: {
            status: 'PROCESSING',
            lockedAt: new Date(),
            lockedBy: workerInstanceId,
          },
        },
        { sort: { nextRetryAt: 1 }, new: true },
      )
      .lean<EmailOutboxLean>()
      .exec();
  }

  async claimPendingBatch(
    batchSize: number = 10,
    workerInstanceId: string = 'worker-1',
  ): Promise<EmailOutboxDocument[]> {
    const pendingDocs = await this.outboxModel
      .find({
        status: 'PENDING',
        nextRetryAt: { $lte: new Date() },
      })
      .sort({ nextRetryAt: 1 })
      .limit(batchSize)
      .exec();

    const claimed: EmailOutboxDocument[] = [];
    for (const doc of pendingDocs) {
      const updated = await this.outboxModel.findOneAndUpdate(
        {
          _id: doc._id,
          status: 'PENDING',
        },
        {
          $set: {
            status: 'PROCESSING',
            lockedAt: new Date(),
            lockedBy: workerInstanceId,
          },
        },
        { new: true },
      );
      if (updated) claimed.push(updated);
    }
    return claimed;
  }

  async markSent(
    id: Types.ObjectId,
    messageId: string,
  ): Promise<EmailOutboxLean | null> {
    return this.outboxModel
      .findByIdAndUpdate(
        id,
        {
          $set: {
            status: 'SENT',
            messageId,
            sentAt: new Date(),
            lockedAt: null,
            lockedBy: null,
          },
        },
        { new: true },
      )
      .lean<EmailOutboxLean>()
      .exec();
  }

  async markFailed(
    id: Types.ObjectId,
    errorMessage: string,
    isPermanent = false,
    nextRetryAt = new Date(Date.now() + 60000),
  ): Promise<EmailOutboxLean | null> {
    return this.outboxModel
      .findByIdAndUpdate(
        id,
        {
          $set: {
            status: isPermanent ? 'FAILED_PERMANENT' : 'PENDING',
            lastError: errorMessage,
            nextRetryAt,
            lockedAt: null,
            lockedBy: null,
          },
          $inc: { retryCount: 1 },
        },
        { new: true },
      )
      .lean<EmailOutboxLean>()
      .exec();
  }

  async updateDeliveryWebhook(
    messageId: string,
    event: 'delivered' | 'bounced' | 'opened' | 'failed',
  ): Promise<EmailOutboxLean | null> {
    const statusMap: Record<string, string> = {
      delivered: 'DELIVERED',
      bounced: 'BOUNCED',
      failed: 'FAILED',
    };

    const update: Record<string, any> = {};
    if (statusMap[event]) {
      update.status = statusMap[event];
    }
    if (event === 'delivered') {
      update.deliveredAt = new Date();
    }

    return this.outboxModel
      .findOneAndUpdate({ messageId }, { $set: update }, { new: true })
      .lean<EmailOutboxLean>()
      .exec();
  }

  async updateDeliveryStatusByMessageId(
    messageId: string,
    status: string,
  ): Promise<EmailOutboxLean | null> {
    return this.outboxModel
      .findOneAndUpdate({ messageId }, { $set: { status } }, { new: true })
      .lean<EmailOutboxLean>()
      .exec();
  }

  async reclaimStuckProcessing(stuckThresholdMs = 300000): Promise<number> {
    const thresholdDate = new Date(Date.now() - stuckThresholdMs);
    const result = await this.outboxModel.updateMany(
      { status: 'PROCESSING', lockedAt: { $lt: thresholdDate } },
      {
        $set: {
          status: 'PENDING',
          lockedAt: null,
          lockedBy: null,
          nextRetryAt: new Date(),
        },
      },
    );
    return result.modifiedCount;
  }
}
