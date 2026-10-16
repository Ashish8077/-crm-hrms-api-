import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, ClientSession, Types } from 'mongoose';
import { AuditLog, AuditLogDocument } from '../schemas/audit-log.schema';
import { CreateAuditLogParams } from '../audit-logs.service';
import { AuditTargetModel } from '../constants/audit-log.constant';

@Injectable()
export class AuditLogRepository {
  constructor(
    @InjectModel(AuditLog.name)
    private readonly auditLogModel: Model<AuditLogDocument>,
  ) {}

  async create(
    data: CreateAuditLogParams,
    session?: ClientSession,
  ): Promise<AuditLogDocument> {
    const auditLog = new this.auditLogModel(data);
    return auditLog.save({ session });
  }

  async findByTarget(
    targetModel: AuditTargetModel,
    targetId: Types.ObjectId,
    limit = 100,
  ): Promise<AuditLogDocument[]> {
    return this.auditLogModel
      .find({ targetModel, targetId })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean<AuditLogDocument[]>()
      .exec();
  }
}
