import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { LeadSource } from '../constants/lead-source.constant';
import { LeadStatus } from '../constants/lead-status.constant';
import { LeadNote, LeadNoteSchema } from './lead-note.schema';
import { LeadFollowUp, LeadFollowUpSchema } from './lead-follow-up.schema';
import { LeadDocument, LeadDocumentSchema } from './lead-document.schema';

export type LeadDocumentType = HydratedDocument<Lead>;

@Schema({
  collection: 'leads',
  timestamps: true,
  versionKey: false,
})
export class Lead {
  @Prop({ type: String, required: true, trim: true })
  firstName!: string;

  @Prop({ type: String, required: true, trim: true })
  lastName!: string;

  @Prop({
    type: String,
    required: true,
    lowercase: true,
    trim: true,
    index: true,
  })
  email!: string;

  @Prop({ type: String, required: true, trim: true, index: true })
  phone!: string;

  @Prop({ type: String, trim: true, default: null })
  companyName?: string | null;

  @Prop({ type: String, trim: true, default: null })
  jobTitle?: string | null;

  @Prop({
    type: String,
    enum: Object.values(LeadSource),
    default: LeadSource.OTHER,
    index: true,
  })
  source!: LeadSource;

  @Prop({
    type: String,
    enum: Object.values(LeadStatus),
    default: LeadStatus.NEW,
    index: true,
  })
  status!: LeadStatus;

  @Prop({ type: Number, default: 0, index: true })
  score!: number;

  @Prop({ type: [String], default: [] })
  tags!: string[];

  @Prop({ type: Types.ObjectId, ref: 'User', default: null, index: true })
  ownerId!: Types.ObjectId | null;

  @Prop({ type: [LeadNoteSchema], default: [] })
  notes!: LeadNote[];

  @Prop({ type: [LeadFollowUpSchema], default: [] })
  followUps!: LeadFollowUp[];

  @Prop({ type: [LeadDocumentSchema], default: [] })
  documents!: LeadDocument[];

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

export const LeadSchema = SchemaFactory.createForClass(Lead);

// Compound queries
LeadSchema.index(
  { ownerId: 1, status: 1, deletedAt: 1 },
  { name: 'idx_leads_owner_status_deleted' },
);

LeadSchema.index(
  { email: 1, deletedAt: 1 },
  { name: 'idx_leads_email_deleted' },
);

LeadSchema.index(
  { phone: 1, deletedAt: 1 },
  { name: 'idx_leads_phone_deleted' },
);

LeadSchema.index(
  { status: 1, deletedAt: 1 },
  { name: 'idx_leads_status_deleted' },
);

LeadSchema.index(
  { source: 1, deletedAt: 1 },
  { name: 'idx_leads_source_deleted' },
);

LeadSchema.index(
  { score: -1, deletedAt: 1 },
  { name: 'idx_leads_score_deleted' },
);
