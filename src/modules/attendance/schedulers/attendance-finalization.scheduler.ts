import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AttendanceFinalizationService } from '../services/attendance-finalization.service';

/**
 * AttendanceFinalizationScheduler
 *
 * Deployment Requirement:
 * Assumes a single active scheduler instance in the current deployment topology.
 * Distributed locking (e.g. Redis or Redlock) is intentionally omitted to keep
 * infrastructure lean and simple for the current HRMS scale (200–1,000 employees).
 *
 * Concurrency & Idempotency Guarantee:
 * If concurrent scheduler runs or overlapping executions ever occur, the database layer
 * guarantees safety:
 * 1. Compound unique index: `{ employeeId: 1, attendanceDate: 1 }`
 * 2. Atomic creation (`createAbsentRecord`) with duplicate-key (E11000) race handling
 * 3. Never overwrites existing attendance records
 */
@Injectable()
export class AttendanceFinalizationScheduler {
  private readonly logger = new Logger(AttendanceFinalizationScheduler.name);

  constructor(
    private readonly finalizationService: AttendanceFinalizationService,
  ) {}

  /**
   * Daily Absence Finalization Job.
   * Runs daily at 08:00 AM after all overnight and standard shifts
   * from the previous cycle have concluded their shift end and grace period.
   */
  @Cron(CronExpression.EVERY_DAY_AT_8AM)
  async handleDailyAbsenceFinalization(): Promise<void> {
    try {
      this.logger.log('Starting daily attendance absence finalization run...');
      const metrics = await this.finalizationService.finalizeAbsences();
      this.logger.log(
        `Daily attendance absence finalization completed: ` +
          `${metrics.absentCreatedCount} ABSENT record(s) created for ${metrics.totalEmployeesEvaluated} employee(s).`,
      );
    } catch (err: unknown) {
      this.logger.error(
        `Error during daily attendance absence finalization: ${(err as Error).message}`,
        (err as Error).stack,
      );
    }
  }
}
