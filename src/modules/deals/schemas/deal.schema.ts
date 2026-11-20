import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { DealStage } from '../constants/deal-stage.constant';
import { DealStatus } from '../constants/deal-status.constant';
import {
  DEFAULT_CURRENCY,
  DEFAULT_PIPELINE,
  DealPriority,
} from '../constants/deal.constant';
import { DealProduct, DealProductSchema } from './deal-product.schema';
import { DealNote, DealNoteSchema } from './deal-note.schema';
import { ClosureHistory, ClosureHistorySchema } from './closure-history.schema';

export type DealDocumentType = HydratedDocument<Deal>;

@Schema({
  collection: 'deals',
  timestamps: true,
  versionKey: false,
})
export class Deal {
  @Prop({ type: String, required: true, trim: true, index: true })
  title!: string;

  @Prop({ type: String, trim: true, default: null })
  description?: string | null;

  @Prop({ type: String, default: DEFAULT_PIPELINE, trim: true, index: true })
  pipeline!: string;

  @Prop({
    type: String,
    enum: Object.values(DealStage),
    default: DealStage.NEW,
    index: true,
  })
  stage!: DealStage;

  @Prop({
    type: String,
    enum: Object.values(DealStatus),
    default: DealStatus.OPEN,
    index: true,
  })
  status!: DealStatus;

  @Prop({ type: Number, required: true, min: 0, index: true })
  amount!: number;

  @Prop({
    type: String,
    default: DEFAULT_CURRENCY,
    uppercase: true,
    trim: true,
    index: true,
  })
  currency!: string;

  @Prop({ type: Number, required: true, min: 0, max: 100, default: 10 })
  probability!: number;

  @Prop({ type: Date, default: null, index: true })
  expectedCloseDate?: Date | null;

  @Prop({ type: Date, default: null, index: true })
  actualCloseDate?: Date | null;

  @Prop({ type: Types.ObjectId, ref: 'Company', default: null, index: true })
  companyId?: Types.ObjectId | null;

  @Prop({ type: Types.ObjectId, ref: 'Contact', default: null, index: true })
  contactId?: Types.ObjectId | null;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null, index: true })
  ownerId!: Types.ObjectId | null;

  @Prop({ type: Types.ObjectId, ref: 'Lead', default: null, index: true })
  leadId?: Types.ObjectId | null;

  @Prop({ type: [DealProductSchema], default: [] })
  products!: DealProduct[];

  @Prop({ type: [DealNoteSchema], default: [] })
  notes!: DealNote[];

  @Prop({ type: [ClosureHistorySchema], default: [] })
  closureHistory!: ClosureHistory[];

  @Prop({ type: String, trim: true, default: null })
  lostReason?: string | null;

  @Prop({ type: String, trim: true, default: null })
  lostCompetitor?: string | null;

  @Prop({ type: [String], default: [], index: true })
  tags!: string[];

  @Prop({
    type: String,
    enum: Object.values(DealPriority),
    default: DealPriority.MEDIUM,
    index: true,
  })
  priority!: DealPriority;

  @Prop({ type: Date, default: null, index: true })
  deletedAt!: Date | null;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  createdBy!: Types.ObjectId | null;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  updatedBy!: Types.ObjectId | null;

  @Prop({ type: Types.ObjectId, ref: 'User', default: null })
  deletedBy!: Types.ObjectId | null;

  createdAt?: Date;
  updatedAt?: Date;
}

export const DealSchema = SchemaFactory.createForClass(Deal);

// Compound Indexes for High-Traffic Query Plans
DealSchema.index(
  { pipeline: 1, stage: 1, deletedAt: 1 },
  { name: 'idx_deals_pipeline_stage' },
);

DealSchema.index(
  { ownerId: 1, status: 1, deletedAt: 1 },
  { name: 'idx_deals_owner_status' },
);

DealSchema.index(
  { status: 1, currency: 1, expectedCloseDate: 1, deletedAt: 1 },
  { name: 'idx_deals_forecast_open' },
);

DealSchema.index({ companyId: 1, deletedAt: 1 }, { name: 'idx_deals_company' });

DealSchema.index({ contactId: 1, deletedAt: 1 }, { name: 'idx_deals_contact' });
