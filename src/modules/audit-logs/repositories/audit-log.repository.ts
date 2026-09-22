import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, ClientSession } from 'mongoose';
import { AuditLog, AuditLogDocument } from '../schemas/audit-log.schema';
import { CreateAuditLogParams } from '../audit-logs.service';

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
}
