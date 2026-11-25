import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Response } from 'express';
import ExcelJS from 'exceljs';
import { Lead, LeadDocumentType } from '../../leads/schemas/lead.schema';
import { Deal, DealDocumentType } from '../../deals/schemas/deal.schema';
import {
  CrmActivity,
  CrmActivityDocument,
} from '../../../common/schemas/crm-activity.schema';
import { Task, TaskDocument } from '../../tasks/schemas/task.schema';
import {
  ALLOWED_FIELDS,
  FINANCIAL_FIELDS,
  AllowedEntity,
} from '../constants/dashboard-allowlist.constant';
import { DataScope } from '../types/data-scope.types';
import { ExportQueryDto } from '../dto/export-query.dto';

@Injectable()
export class ExportService {
  constructor(
    @InjectModel(Lead.name)
    private readonly leadModel: Model<LeadDocumentType>,
    @InjectModel(Deal.name)
    private readonly dealModel: Model<DealDocumentType>,
    @InjectModel(CrmActivity.name)
    private readonly activityModel: Model<CrmActivityDocument>,
    @InjectModel(Task.name)
    private readonly taskModel: Model<TaskDocument>,
  ) {}

  /**
   * Sanitizes string values to prevent formula injection in CSV/Excel.
   * If value starts with '=', '+', '-', '@', prefixes with a tab '\t'.
   */
  private sanitizeValue(val: unknown): string {
    if (val === null || val === undefined) return '';
    let str: string;
    if (
      typeof val === 'string' ||
      typeof val === 'number' ||
      typeof val === 'boolean' ||
      typeof val === 'bigint' ||
      typeof val === 'symbol'
    ) {
      str = String(val);
    } else if (val instanceof Date || val instanceof Types.ObjectId) {
      str = val.toString();
    } else if (
      typeof val === 'object' &&
      'toHexString' in val &&
      typeof val.toHexString === 'function'
    ) {
      str = (val as { toHexString(): string }).toHexString();
    } else if (Array.isArray(val)) {
      str = (val as unknown[]).join(',');
    } else {
      str = Object.prototype.toString.call(val);
    }
    if (/^[=+\-@]/.test(str)) {
      str = `\t${str}`;
    }
    return str;
  }

  private escapeCsvCell(val: string): string {
    return `"${val.replace(/"/g, '""')}"`;
  }

  async exportReport(
    scope: DataScope,
    dto: ExportQueryDto,
    res: Response,
  ): Promise<void> {
    const entity = dto.entity as AllowedEntity;
    const allowed = ALLOWED_FIELDS[entity];
    let selectedFields: string[] =
      dto.fields && dto.fields.length > 0
        ? dto.fields.filter((f: string) => allowed.includes(f))
        : [...allowed];

    // Redact financial fields if caller has no financial permission
    if (!scope.canViewFinancial) {
      selectedFields = selectedFields.filter(
        (f: string) => !FINANCIAL_FIELDS.has(f),
      );
    }

    if (selectedFields.length === 0) {
      throw new BadRequestException('No permitted fields selected for export.');
    }

    // Build query filter
    const filter: Record<string, unknown> = { deletedAt: null };
    if (entity === 'leads' || entity === 'deals') {
      filter.ownerId = { $in: scope.ownerIds };
    } else if (entity === 'activities') {
      filter.performedBy = { $in: scope.ownerIds };
    } else if (entity === 'tasks') {
      filter.assignedTo = { $in: scope.ownerIds };
    }

    if (dto.startDate || dto.endDate) {
      const dateField = entity === 'activities' ? 'activityDate' : 'createdAt';
      const range: Record<string, Date> = {};
      if (dto.startDate) range.$gte = new Date(dto.startDate);
      if (dto.endDate) {
        const end = new Date(dto.endDate);
        end.setUTCHours(23, 59, 59, 999);
        range.$lte = end;
      }
      filter[dateField] = range;
    }

    // Maximum export safety limit
    const MAX_EXPORT_ROWS = 10000;

    let cursor;
    if (entity === 'leads') {
      cursor = this.leadModel
        .find(filter)
        .select(selectedFields.join(' '))
        .limit(MAX_EXPORT_ROWS)
        .lean()
        .cursor();
    } else if (entity === 'deals') {
      cursor = this.dealModel
        .find(filter)
        .select(selectedFields.join(' '))
        .limit(MAX_EXPORT_ROWS)
        .lean()
        .cursor();
    } else if (entity === 'activities') {
      cursor = this.activityModel
        .find(filter)
        .select(selectedFields.join(' '))
        .limit(MAX_EXPORT_ROWS)
        .lean()
        .cursor();
    } else {
      cursor = this.taskModel
        .find(filter)
        .select(selectedFields.join(' '))
        .limit(MAX_EXPORT_ROWS)
        .lean()
        .cursor();
    }

    const timestamp = new Date().toISOString().slice(0, 10);
    const filename = `crm-${entity}-export-${timestamp}`;

    if (dto.format === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${filename}.csv"`,
      );
      // BOM for Excel compatibility
      res.write('\uFEFF');
      res.write(
        selectedFields.map((f: string) => this.escapeCsvCell(f)).join(',') +
          '\r\n',
      );

      let rowCount = 0;
      for await (const doc of cursor) {
        const row = doc as unknown as Record<string, unknown>;
        const line = selectedFields
          .map((f: string) => this.escapeCsvCell(this.sanitizeValue(row[f])))
          .join(',');
        res.write(line + '\r\n');
        rowCount++;
      }

      res.setHeader('X-Row-Count', rowCount.toString());
      res.end();
    } else {
      // XLSX streaming export via exceljs
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${filename}.xlsx"`,
      );

      const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
        stream: res,
        useStyles: true,
      });

      const worksheet = workbook.addWorksheet(`${entity.toUpperCase()}`);
      worksheet.addRow(selectedFields).commit();

      let rowCount = 0;
      for await (const doc of cursor) {
        const row = doc as unknown as Record<string, unknown>;
        const rowValues = selectedFields.map((f: string) =>
          this.sanitizeValue(row[f]),
        );
        worksheet.addRow(rowValues).commit();
        rowCount++;
      }

      res.setHeader('X-Row-Count', rowCount.toString());
      worksheet.commit();
      await workbook.commit();
    }
  }
}
