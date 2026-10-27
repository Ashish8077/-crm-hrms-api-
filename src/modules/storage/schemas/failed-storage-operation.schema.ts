import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type FailedStorageOperationDocument =
  HydratedDocument<FailedStorageOperation>;

export enum StorageOperationType {
  DELETE = 'DELETE',
}

export enum FailedStorageStatus {
  PENDING = 'PENDING',
  FAILED = 'FAILED',
  COMPLETED = 'COMPLETED',
}

@Schema({
  collection: 'failed_storage_operations',
  timestamps: true,
  versionKey: false,
})
export class FailedStorageOperation {
  @Prop({ type: String, required: true, index: true })
  fileKey!: string;

  @Prop({
    type: String,
    enum: Object.values(StorageOperationType),
    default: StorageOperationType.DELETE,
    required: true,
  })
  operation!: StorageOperationType;

  @Prop({ type: Number, default: 0 })
  retryCount!: number;

  @Prop({ type: Date, default: Date.now, index: true })
  nextRetryAt!: Date;

  @Prop({
    type: String,
    enum: Object.values(FailedStorageStatus),
    default: FailedStorageStatus.PENDING,
    index: true,
  })
  status!: FailedStorageStatus;

  @Prop({ type: String, default: null })
  lastError?: string | null;
}

export const FailedStorageOperationSchema = SchemaFactory.createForClass(
  FailedStorageOperation,
);

FailedStorageOperationSchema.index(
  { status: 1, nextRetryAt: 1 },
  { name: 'idx_failed_storage_status_retry' },
);
