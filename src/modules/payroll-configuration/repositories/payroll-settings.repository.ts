import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import {
  PayrollSettings,
  PayrollSettingsDocument,
  PayrollSettingsLean,
} from '../schemas/payroll-settings.schema';
import {
  PAYROLL_CONFIGURATION_DEFAULTS,
  PAYROLL_SETTINGS_SINGLETON_KEY,
  PayrollFrequency,
  WorkingDaysPolicy,
} from '../constants/payroll-configuration.constant';

export interface UpsertPayrollSettingsInput {
  currency?: string;
  currencyPrecision?: number;
  payrollFrequency?: PayrollFrequency;
  cutoffDay?: number;
  paymentDay?: number;
  financialYearStartMonth?: number;
  workingDaysPolicy?: WorkingDaysPolicy;
  fixedWorkingDaysPerMonth?: number | null;
  isPayrollProcessingEnabled?: boolean;
  updatedBy: Types.ObjectId | null;
}

interface MongoErrorShape {
  code?: number;
  message?: string;
  name?: string;
  cause?: {
    code?: number;
    message?: string;
  };
}

@Injectable()
export class PayrollSettingsRepository {
  constructor(
    @InjectModel(PayrollSettings.name)
    private readonly settingsModel: Model<PayrollSettingsDocument>,
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
  ): Promise<PayrollSettingsLean | null> {
    const query = this.settingsModel.findOne({
      singletonKey: PAYROLL_SETTINGS_SINGLETON_KEY,
    });
    if (session) {
      query.session(session);
    }
    return query.lean<PayrollSettingsLean>().exec();
  }

  async findOrCreateDefault(
    actorId: Types.ObjectId | null,
    session?: ClientSession,
  ): Promise<{ settings: PayrollSettingsLean; created: boolean }> {
    const existing = await this.findActive(session);
    if (existing) {
      return { settings: existing, created: false };
    }

    const defaultPayload = {
      singletonKey: PAYROLL_SETTINGS_SINGLETON_KEY,
      currency: PAYROLL_CONFIGURATION_DEFAULTS.CURRENCY,
      currencyPrecision: PAYROLL_CONFIGURATION_DEFAULTS.CURRENCY_PRECISION,
      payrollFrequency: PAYROLL_CONFIGURATION_DEFAULTS.PAYROLL_FREQUENCY,
      cutoffDay: PAYROLL_CONFIGURATION_DEFAULTS.CUTOFF_DAY,
      paymentDay: PAYROLL_CONFIGURATION_DEFAULTS.PAYMENT_DAY,
      financialYearStartMonth:
        PAYROLL_CONFIGURATION_DEFAULTS.FINANCIAL_YEAR_START_MONTH,
      workingDaysPolicy: PAYROLL_CONFIGURATION_DEFAULTS.WORKING_DAYS_POLICY,
      fixedWorkingDaysPerMonth:
        PAYROLL_CONFIGURATION_DEFAULTS.FIXED_WORKING_DAYS_PER_MONTH,
      isPayrollProcessingEnabled:
        PAYROLL_CONFIGURATION_DEFAULTS.IS_PAYROLL_PROCESSING_ENABLED,
      hasProcessedPayroll: false,
      createdBy: actorId,
      updatedBy: actorId,
    };

    try {
      const created = await this.settingsModel
        .findOneAndUpdate(
          { singletonKey: PAYROLL_SETTINGS_SINGLETON_KEY },
          { $setOnInsert: defaultPayload },
          {
            upsert: true,
            returnDocument: 'after',
            setDefaultsOnInsert: true,
            runValidators: true,
            session,
          },
        )
        .lean<PayrollSettingsLean>()
        .exec();

      return { settings: created, created: true };
    } catch (error: unknown) {
      // Handle race on concurrent first GET by reading the inserted singleton
      if (this.isDuplicateKeyError(error)) {
        const doc = await this.findActive(session);
        if (doc) {
          return { settings: doc, created: false };
        }
      }
      throw error;
    }
  }

  async upsertSettings(
    data: UpsertPayrollSettingsInput,
    actorId: Types.ObjectId,
    expectedVersion?: number,
    session?: ClientSession,
  ): Promise<PayrollSettingsLean | null> {
    const sanitizedSet: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      if (value !== undefined) {
        sanitizedSet[key] = value;
      }
    }

    const filter: Record<string, unknown> = {
      singletonKey: PAYROLL_SETTINGS_SINGLETON_KEY,
    };
    if (typeof expectedVersion === 'number') {
      filter.__v = expectedVersion;
    }

    const query = this.settingsModel.findOneAndUpdate(
      filter,
      {
        $set: sanitizedSet,
        $setOnInsert: {
          singletonKey: PAYROLL_SETTINGS_SINGLETON_KEY,
          hasProcessedPayroll: false,
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

    return query.lean<PayrollSettingsLean>().exec();
  }
}
