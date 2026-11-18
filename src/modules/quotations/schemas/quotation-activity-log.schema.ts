import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type QuotationActivityLogDocument = HydratedDocument<QuotationActivityLog>;

export interface ActivityMetadata {
  previousStatus?: string;
  newStatus?: string;
  tierLevel?: number;
  comment?: string;
  extendedDays?: number;
  newExpiryDate?: Date;
  orderId?: string;
  orderNumber?: string;
  ipAddress?: string;
  userAgent?: string;
}

@Schema({ collection: 'quotation_activity_logs', timestamps: true, versionKey: false })
export class QuotationActivityLog {
  @Prop({ type: Types.ObjectId, ref: 'Quotation', required: true, index: true })
  quotationId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'Company', required: true, index: true })
  companyId!: Types.ObjectId;

  @Prop({
    type: String,
    required: true,
    enum: [
      'CREATED',
      'UPDATED',
      'STATUS_CHANGED',
      'EMAIL_SENT',
      'EMAIL_RESENT',
      'EMAIL_BOUNCED',
      'EMAIL_OPENED',
      'APPROVAL_REQUESTED',
      'APPROVAL_SUBMITTED',
      'APPROVAL_TIER_APPROVED',
      'APPROVAL_TIER_REJECTED',
      'APPROVED',
      'REJECTED',
      'VALIDITY_EXTENDED',
      'REVISED',
      'REVISION_SPAWNED',
      'ORDER_CONVERTED',
      'CONVERTED_TO_ORDER',
      'CLIENT_VIEWED',
      'CUSTOMER_VIEWED',
      'ACCEPTED',
      'CUSTOMER_ACCEPTED',
      'CUSTOMER_REJECTED',
      'PDF_GENERATED',
    ],
    index: true,
  })
  action!: string;

  @Prop({ type: String, trim: true, default: null })
  description?: string | null;

  @Prop({ type: Object, default: {} })
  metadata!: ActivityMetadata;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  performedBy?: Types.ObjectId | null;

  @Prop({ type: String, trim: true, default: null })
  ipAddress?: string | null;

  @Prop({ type: String, trim: true, default: null })
  userAgent?: string | null;
}

export const QuotationActivityLogSchema = SchemaFactory.createForClass(QuotationActivityLog);
QuotationActivityLogSchema.index({ companyId: 1, quotationId: 1, createdAt: -1 });
