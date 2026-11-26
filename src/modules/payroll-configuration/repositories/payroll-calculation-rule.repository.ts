import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import {
  PayrollCalculationRule,
  PayrollCalculationRuleDocument,
  PayrollCalculationRuleLean,
  StatutoryCalculationFlags,
} from '../schemas/payroll-calculation-rule.schema';
import {
  NegativeNetPayPolicy,
  PAYROLL_CALCULATION_RULES_SINGLETON_KEY,
  PAYROLL_CONFIGURATION_DEFAULTS,
  PayrollProrationPolicy,
  PayrollRoundingMode,
} from '../constants/payroll-configuration.constant';

export interface UpsertPayrollCalculationRuleInput {
  roundingMode?: PayrollRoundingMode;
  roundingPrecision?: number;
  prorationPolicy?: PayrollProrationPolicy;
  prorateFixedComponents?: boolean;
  prorateDeductions?: boolean;
  prorateEmployerContributions?: boolean;
  negativeNetPayPolicy?: NegativeNetPayPolicy;
  statutoryConfig?: StatutoryCalculationFlags;
  componentExecutionOrder?: string[];
  updatedBy: Types.ObjectId | null;
}

interface MongoErrorShape {
  code?: number;
  message?: string;
  cause?: { code?: number; message?: string };
}

@Injectable()
export class PayrollCalculationRuleRepository {
  constructor(
    @InjectModel(PayrollCalculationRule.name)
    private readonly ruleModel: Model<PayrollCalculationRuleDocument>,
  ) {}

  isDuplicateKeyError(error: unknown): boolean {
    if (typeof error !== 'object' || error === null) return false;
    const err = error as MongoErrorShape;
    if (err.code === 11000) return true;
    if (typeof err.message === 'string' && err.message.includes('E11000')) {
      return true;
    }
    if (err.cause && typeof err.cause === 'object') {
      if (
        err.cause.code === 11000 ||
        (typeof err.cause.message === 'string' &&
          err.cause.message.includes('E11000'))
      ) {
        return true;
      }
    }
    return false;
  }

  async findActive(
    session?: ClientSession,
  ): Promise<PayrollCalculationRuleLean | null> {
    const query = this.ruleModel.findOne({
      singletonKey: PAYROLL_CALCULATION_RULES_SINGLETON_KEY,
    });
    if (session) {
      query.session(session);
    }
    return query.lean<PayrollCalculationRuleLean>().exec();
  }

  async findOrCreateDefault(
    actorId: Types.ObjectId | null,
    session?: ClientSession,
  ): Promise<{ rule: PayrollCalculationRuleLean; created: boolean }> {
    const existing = await this.findActive(session);
    if (existing) {
      return { rule: existing, created: false };
    }

    const defaultPayload = {
      singletonKey: PAYROLL_CALCULATION_RULES_SINGLETON_KEY,
      roundingMode: PAYROLL_CONFIGURATION_DEFAULTS.ROUNDING_MODE,
      roundingPrecision: PAYROLL_CONFIGURATION_DEFAULTS.ROUNDING_PRECISION,
      prorationPolicy: PAYROLL_CONFIGURATION_DEFAULTS.PRORATION_POLICY,
      prorateFixedComponents:
        PAYROLL_CONFIGURATION_DEFAULTS.PRORATE_FIXED_COMPONENTS,
      prorateDeductions: PAYROLL_CONFIGURATION_DEFAULTS.PRORATE_DEDUCTIONS,
      prorateEmployerContributions:
        PAYROLL_CONFIGURATION_DEFAULTS.PRORATE_EMPLOYER_CONTRIBUTIONS,
      negativeNetPayPolicy:
        PAYROLL_CONFIGURATION_DEFAULTS.NEGATIVE_NET_PAY_POLICY,
      statutoryConfig: { ...PAYROLL_CONFIGURATION_DEFAULTS.STATUTORY_CONFIG },
      componentExecutionOrder: [],
      createdBy: actorId,
      updatedBy: actorId,
    };

    try {
      const created = await this.ruleModel
        .findOneAndUpdate(
          { singletonKey: PAYROLL_CALCULATION_RULES_SINGLETON_KEY },
          { $setOnInsert: defaultPayload },
          {
            upsert: true,
            returnDocument: 'after',
            setDefaultsOnInsert: true,
            runValidators: true,
            session,
          },
        )
        .lean<PayrollCalculationRuleLean>()
        .exec();

      return { rule: created, created: true };
    } catch (error: unknown) {
      if (this.isDuplicateKeyError(error)) {
        const doc = await this.findActive(session);
        if (doc) {
          return { rule: doc, created: false };
        }
      }
      throw error;
    }
  }

  async upsertRule(
    data: UpsertPayrollCalculationRuleInput,
    actorId: Types.ObjectId,
    expectedVersion?: number,
    session?: ClientSession,
  ): Promise<PayrollCalculationRuleLean | null> {
    const sanitizedSet: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      if (value !== undefined) {
        sanitizedSet[key] = value;
      }
    }

    const filter: Record<string, unknown> = {
      singletonKey: PAYROLL_CALCULATION_RULES_SINGLETON_KEY,
    };
    if (typeof expectedVersion === 'number') {
      filter.__v = expectedVersion;
    }

    const query = this.ruleModel.findOneAndUpdate(
      filter,
      {
        $set: sanitizedSet,
        $setOnInsert: {
          singletonKey: PAYROLL_CALCULATION_RULES_SINGLETON_KEY,
          createdBy: actorId,
        },
        $inc: { __v: 1 },
      },
      {
        upsert: expectedVersion === undefined,
        returnDocument: 'after',
        setDefaultsOnInsert: true,
        runValidators: true,
      },
    );

    if (session) {
      query.session(session);
    }

    return query.lean<PayrollCalculationRuleLean>().exec();
  }
}
