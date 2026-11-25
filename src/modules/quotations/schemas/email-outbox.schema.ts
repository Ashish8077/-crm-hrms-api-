import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type EmailOutboxDocument = HydratedDocument<EmailOutbox>;

export interface EmailOutboxContext {
  recipientName: string;
  quoteNumber: string;
  grandTotalFormatted: string;
  expiryDateFormatted: string;
  portalUrl?: string;
  customMessage?: string;
}

@Schema({
  collection: 'quotation_email_outbox',
  timestamps: true,
  versionKey: false,
})
export class EmailOutbox {
  @Prop({ type: Types.ObjectId, ref: 'Quotation', required: true, index: true })
  quotationId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Company', required: true, index: true })
  companyId!: Types.ObjectId;

  @Prop({ type: String, required: true, trim: true })
  recipientEmail!: string;

  @Prop({ type: String, required: true, trim: true })
  subject!: string;

  @Prop({
    type: String,
    enum: ['PROPOSAL_DISPATCH', 'EXPIRY_REMINDER_48H', 'REVISION_NOTICE'],
    default: 'PROPOSAL_DISPATCH',
  })
  templateType?: string;

  @Prop({ type: Object, default: {} })
  context?: EmailOutboxContext;

  @Prop({ type: String, trim: true, default: null })
  htmlBody?: string | null;

  @Prop({ type: String, trim: true, default: null })
  pdfKey?: string | null;

  @Prop({ type: String, trim: true, required: true, unique: true, index: true })
  idempotencyKey!: string;

  @Prop({
    type: String,
    enum: [
      'PENDING',
      'PROCESSING',
      'SENT',
      'DELIVERED',
      'BOUNCED',
      'FAILED',
      'FAILED_PERMANENT',
    ],
    default: 'PENDING',
    index: true,
  })
  status!: string;

  @Prop({ type: Number, default: 0 })
  retryCount!: number;

  @Prop({ type: Date, required: true, default: Date.now, index: true })
  nextRetryAt!: Date;

  @Prop({ type: Date, default: null })
  lockedAt?: Date | null;

  @Prop({ type: String, default: null })
  lockedBy?: string | null;

  @Prop({ type: String, trim: true, default: null })
  lastError?: string | null;

  @Prop({ type: String, trim: true, default: null })
  messageId?: string | null;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  sentBy?: Types.ObjectId | null;

  @Prop({ type: Date, default: null })
  sentAt?: Date | null;

  @Prop({ type: Date, default: null })
  deliveredAt?: Date | null;
}

export const EmailOutboxSchema = SchemaFactory.createForClass(EmailOutbox);
EmailOutboxSchema.index({ status: 1, nextRetryAt: 1 });
EmailOutboxSchema.index({ companyId: 1, quotationId: 1, createdAt: -1 });
