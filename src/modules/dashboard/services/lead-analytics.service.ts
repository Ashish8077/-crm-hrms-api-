import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, PipelineStage } from 'mongoose';
import { Lead, LeadDocumentType } from '../../leads/schemas/lead.schema';
import { LeadStatus } from '../../leads/constants/lead-status.constant';
import { DataScope } from '../types/data-scope.types';

@Injectable()
export class LeadAnalyticsService {
  constructor(
    @InjectModel(Lead.name)
    private readonly leadModel: Model<LeadDocumentType>,
  ) {}

  private buildDateFilter(startDate?: string, endDate?: string) {
    if (!startDate && !endDate) return {};
    const dateFilter: Record<string, unknown> = {};
    if (startDate) dateFilter.$gte = new Date(startDate);
    if (endDate) {
      const end = new Date(endDate);
      end.setUTCHours(23, 59, 59, 999);
      dateFilter.$lte = end;
    }
    return { createdAt: dateFilter };
  }

  async getLeadKpiSummary(
    scope: DataScope,
    startDate?: string,
    endDate?: string,
  ) {
    const pipeline: PipelineStage[] = [
      {
        $match: {
          ownerId: { $in: scope.ownerIds },
          deletedAt: null,
          ...this.buildDateFilter(startDate, endDate),
        },
      },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
        },
      },
    ];

    const results = await this.leadModel.aggregate<{ _id: string; count: number }>(pipeline).exec();
    const countMap: Record<string, number> = {};
    let totalLeads = 0;

    for (const r of results) {
      countMap[r._id] = r.count;
      totalLeads += r.count;
    }

    const newLeads = countMap[LeadStatus.NEW] || 0;
    const qualifiedLeads =
      (countMap[LeadStatus.QUALIFIED] || 0) +
      (countMap[LeadStatus.PROPOSAL] || 0) +
      (countMap[LeadStatus.NEGOTIATION] || 0) +
      (countMap[LeadStatus.WON] || 0);
    const convertedLeads = countMap[LeadStatus.WON] || 0;
    const lostLeads = (countMap[LeadStatus.LOST] || 0) + (countMap[LeadStatus.DISQUALIFIED] || 0);

    const conversionRate = totalLeads > 0 ? Number(((convertedLeads / totalLeads) * 100).toFixed(2)) : 0;
    const qualificationRate = totalLeads > 0 ? Number(((qualifiedLeads / totalLeads) * 100).toFixed(2)) : 0;

    return {
      totalLeads,
      newLeads,
      qualifiedLeads,
      convertedLeads,
      lostLeads,
      conversionRate,
      qualificationRate,
    };
  }

  async getLeadFunnel(
    scope: DataScope,
    startDate?: string,
    endDate?: string,
  ) {
    const pipeline: PipelineStage[] = [
      {
        $match: {
          ownerId: { $in: scope.ownerIds },
          deletedAt: null,
          ...this.buildDateFilter(startDate, endDate),
        },
      },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 },
        },
      },
    ];

    const results = await this.leadModel.aggregate<{ _id: string; count: number }>(pipeline).exec();
    const countMap = new Map<string, number>(results.map((r) => [r._id, r.count]));
    const totalLeads = results.reduce((acc, r) => acc + r.count, 0);

    const allStatuses = Object.values(LeadStatus);
    const stages = allStatuses.map((status) => {
      const count = countMap.get(status) || 0;
      const percentOfTotal = totalLeads > 0 ? Number(((count / totalLeads) * 100).toFixed(2)) : 0;
      return {
        stage: status,
        count,
        percentOfTotal,
      };
    });

    const qualifiedCount =
      (countMap.get(LeadStatus.QUALIFIED) || 0) +
      (countMap.get(LeadStatus.PROPOSAL) || 0) +
      (countMap.get(LeadStatus.NEGOTIATION) || 0) +
      (countMap.get(LeadStatus.WON) || 0);
    const wonCount = countMap.get(LeadStatus.WON) || 0;

    return {
      stages,
      totalLeads,
      leadQualificationRate: totalLeads > 0 ? Number(((qualifiedCount / totalLeads) * 100).toFixed(2)) : 0,
      leadToWonRate: totalLeads > 0 ? Number(((wonCount / totalLeads) * 100).toFixed(2)) : 0,
    };
  }

  async getConversionAnalysis(
    scope: DataScope,
    startDate?: string,
    endDate?: string,
  ) {
    // 1. Overall stats
    const kpis = await this.getLeadKpiSummary(scope, startDate, endDate);

    // 2. Breakdown by source
    const sourcePipeline: PipelineStage[] = [
      {
        $match: {
          ownerId: { $in: scope.ownerIds },
          deletedAt: null,
          ...this.buildDateFilter(startDate, endDate),
        },
      },
      {
        $group: {
          _id: { source: '$source', status: '$status' },
          count: { $sum: 1 },
        },
      },
    ];

    const sourceResults = await this.leadModel
      .aggregate<{ _id: { source: string; status: string }; count: number }>(sourcePipeline)
      .exec();

    const sourceMap = new Map<string, { total: number; won: number }>();
    for (const r of sourceResults) {
      const src = r._id.source || 'OTHER';
      if (!sourceMap.has(src)) {
        sourceMap.set(src, { total: 0, won: 0 });
      }
      const entry = sourceMap.get(src)!;
      entry.total += r.count;
      if (r._id.status === LeadStatus.WON) {
        entry.won += r.count;
      }
    }

    const conversionBySource = Array.from(sourceMap.entries()).map(([source, stats]) => ({
      source,
      totalLeads: stats.total,
      wonDeals: stats.won,
      conversionRate: stats.total > 0 ? Number(((stats.won / stats.total) * 100).toFixed(2)) : 0,
    }));

    return {
      period: { start: startDate ?? null, end: endDate ?? null },
      leadToQualifiedRate: kpis.qualificationRate,
      leadToWonRate: kpis.conversionRate,
      conversionBySource,
    };
  }

  async getLeadsNeedingAttentionCount(scope: DataScope): Promise<number> {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    return this.leadModel
      .countDocuments({
        ownerId: { $in: scope.ownerIds },
        status: { $in: [LeadStatus.NEW, LeadStatus.CONTACTED] },
        deletedAt: null,
        $or: [{ updatedAt: { $lte: sevenDaysAgo } }, { score: { $gte: 50 } }],
      })
      .exec();
  }
}
