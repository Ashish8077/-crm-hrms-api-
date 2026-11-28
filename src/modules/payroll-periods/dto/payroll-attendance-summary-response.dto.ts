import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { EmploymentStatus } from '../../employees/constants/employee.constant';
import { PayrollFrequency } from '../../payroll-configuration/constants/payroll-configuration.constant';
import { PayrollPeriodStatus } from '../constants/payroll-period.constant';

export type PayrollAttendanceWarningCode =
  | 'UNFINALIZED_MISSING_DAYS'
  | 'OPEN_ATTENDANCE_SESSION'
  | 'INCOMPLETE_ATTENDANCE_RECORD'
  | 'DUPLICATE_ATTENDANCE_RECORD'
  | 'UNAPPROVED_REGULARIZED_ATTENDANCE'
  | 'LEAVE_ATTENDANCE_MISMATCH'
  | 'OUTSIDE_TENURE_ATTENDANCE'
  | 'PENDING_LEAVE_CANCELLATION_RECONCILIATION';

export class PayrollAttendancePeriodInfoDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  periodCode!: string;

  @ApiProperty()
  periodName!: string;

  @ApiProperty({ enum: PayrollPeriodStatus })
  status!: PayrollPeriodStatus;

  @ApiProperty({ enum: PayrollFrequency })
  payrollFrequency!: PayrollFrequency;

  @ApiProperty({ example: '2026-06-01' })
  startDate!: string;

  @ApiProperty({ example: '2026-06-30' })
  endDate!: string;

  @ApiProperty()
  month!: number;

  @ApiProperty()
  year!: number;

  @ApiProperty()
  calendarDays!: number;
}

export class PayrollAttendanceFinalizationStateDto {
  @ApiProperty({
    description:
      'True only when the period has concluded across evaluated branches and zero unresolved missing, incomplete, duplicate, or unapproved regularized days exist.',
  })
  attendanceFinalized!: boolean;

  @ApiProperty({
    example: 'DERIVED_FROM_PERIOD_ATTENDANCE_COMPLETENESS',
    description:
      'Explains how attendance finalization state is determined since daily scheduler runs do not persist a period lock table.',
  })
  finalizationBasis!: 'DERIVED_FROM_PERIOD_ATTENDANCE_COMPLETENESS';

  @ApiProperty()
  periodEnded!: boolean;

  @ApiProperty()
  hasUnresolvedGaps!: boolean;

  @ApiProperty()
  unresolvedEmployeeCount!: number;

  @ApiProperty()
  totalMissingDays!: number;

  @ApiProperty()
  totalIncompleteDays!: number;

  @ApiProperty()
  totalDuplicateAttendanceDays!: number;

  @ApiProperty()
  totalUnapprovedRegularizedDays!: number;
}

export class PayrollAttendanceStatusBreakdownDto {
  @ApiProperty()
  present!: number;

  @ApiProperty()
  late!: number;

  @ApiProperty()
  regularized!: number;

  @ApiProperty()
  halfDay!: number;

  @ApiProperty()
  absent!: number;

  @ApiProperty()
  onLeave!: number;

  @ApiProperty()
  incomplete!: number;

  @ApiProperty()
  checkedIn!: number;

  @ApiProperty()
  onBreak!: number;

  @ApiProperty()
  weekOffRecordCount!: number;

  @ApiProperty()
  holidayRecordCount!: number;
}

export class PayrollLeaveTypeBreakdownItemDto {
  @ApiProperty()
  leaveTypeId!: string;

  @ApiProperty()
  leaveTypeCode!: string;

  @ApiProperty()
  leaveTypeName!: string;

  @ApiProperty()
  isPaid!: boolean;

  @ApiProperty()
  days!: number;
}

export class PayrollEmployeeLeaveSummaryDto {
  @ApiProperty()
  paidLeaveDays!: number;

  @ApiProperty()
  unpaidLeaveDays!: number;

  @ApiProperty()
  totalLeaveDays!: number;

  @ApiProperty()
  halfDayLeaveCount!: number;

  @ApiProperty({
    description:
      'Days from leaves in CANCELLATION_REQUESTED status (kept in paid/unpaid totals until HR completes reconciliation).',
  })
  pendingCancellationLeaveDays!: number;

  @ApiProperty({ type: [PayrollLeaveTypeBreakdownItemDto] })
  leaveTypeBreakdown!: PayrollLeaveTypeBreakdownItemDto[];
}

export class PayrollEmployeeAttendanceAnomaliesDto {
  @ApiProperty()
  hasAnomalies!: boolean;

  @ApiProperty({ type: [String] })
  duplicateAttendanceDates!: string[];

  @ApiProperty({ type: [String] })
  unapprovedRegularizedDates!: string[];

  @ApiProperty({ type: [String] })
  openSessionDates!: string[];

  @ApiProperty({ type: [String] })
  incompleteDates!: string[];

  @ApiProperty({ type: [String] })
  missingDates!: string[];

  @ApiProperty({ type: [String] })
  leaveAttendanceMismatchDates!: string[];

  @ApiProperty({ type: [String] })
  outsideTenureAttendanceDates!: string[];

  @ApiProperty({ type: [String] })
  warnings!: PayrollAttendanceWarningCode[];
}

export class EmployeePayrollAttendanceSummaryDto {
  @ApiProperty()
  employeeId!: string;

  @ApiProperty()
  employeeCode!: string;

  @ApiProperty()
  firstName!: string;

  @ApiProperty()
  lastName!: string;

  @ApiProperty({ enum: EmploymentStatus })
  employmentStatus!: EmploymentStatus;

  @ApiProperty()
  branchId!: string;

  @ApiProperty()
  branchTimezone!: string;

  @ApiProperty()
  departmentId!: string;

  @ApiProperty()
  designationId!: string;

  @ApiProperty({ example: '2026-06-01' })
  dateOfJoining!: string;

  @ApiPropertyOptional({ type: String, nullable: true, example: '2026-06-15' })
  effectiveExitDate!: string | null;

  @ApiProperty({ example: '2026-06-01' })
  effectiveStartDate!: string;

  @ApiProperty({ example: '2026-06-30' })
  effectiveEndDate!: string;

  @ApiProperty()
  isMidPeriodJoiner!: boolean;

  @ApiProperty()
  isMidPeriodLeaver!: boolean;

  @ApiProperty()
  tenureCalendarDays!: number;

  @ApiProperty()
  evaluatableCalendarDays!: number;

  @ApiProperty()
  weeklyOffDays!: number;

  @ApiProperty()
  holidayDays!: number;

  @ApiProperty()
  scheduledWorkingDays!: number;

  @ApiProperty()
  evaluatableWorkingDays!: number;

  @ApiProperty()
  futureScheduledWorkingDays!: number;

  @ApiProperty()
  presentDays!: number;

  @ApiProperty()
  halfDays!: number;

  @ApiProperty()
  absentDays!: number;

  @ApiProperty()
  incompleteDays!: number;

  @ApiProperty()
  missingDays!: number;

  @ApiProperty({ type: PayrollAttendanceStatusBreakdownDto })
  statusBreakdown!: PayrollAttendanceStatusBreakdownDto;

  @ApiProperty()
  totalWorkMinutes!: number;

  @ApiProperty()
  totalBreakMinutes!: number;

  @ApiProperty()
  totalOvertimeMinutes!: number;

  @ApiProperty()
  totalLateMinutes!: number;

  @ApiProperty()
  totalEarlyDepartureMinutes!: number;

  @ApiProperty()
  lateInstanceCount!: number;

  @ApiProperty()
  earlyDepartureCount!: number;

  @ApiProperty({ type: PayrollEmployeeLeaveSummaryDto })
  leaveSummary!: PayrollEmployeeLeaveSummaryDto;

  @ApiProperty({ type: PayrollEmployeeAttendanceAnomaliesDto })
  anomalies!: PayrollEmployeeAttendanceAnomaliesDto;
}

export class PayrollAttendanceSummaryTotalsDto {
  @ApiProperty()
  totalTenureCalendarDays!: number;

  @ApiProperty()
  totalScheduledWorkingDays!: number;

  @ApiProperty()
  totalPresentDays!: number;

  @ApiProperty()
  totalHalfDays!: number;

  @ApiProperty()
  totalAbsentDays!: number;

  @ApiProperty()
  totalIncompleteDays!: number;

  @ApiProperty()
  totalMissingDays!: number;

  @ApiProperty()
  totalPaidLeaveDays!: number;

  @ApiProperty()
  totalUnpaidLeaveDays!: number;

  @ApiProperty()
  totalPendingCancellationLeaveDays!: number;

  @ApiProperty()
  totalHolidayDays!: number;

  @ApiProperty()
  totalWeeklyOffDays!: number;
}

export class PayrollAttendancePeriodTotalsSummaryDto {
  @ApiProperty()
  totalEligibleEmployees!: number;

  @ApiProperty()
  returnedEmployeesCount!: number;

  @ApiProperty()
  employeesWithAnomalies!: number;

  @ApiProperty({ type: PayrollAttendanceSummaryTotalsDto })
  totals!: PayrollAttendanceSummaryTotalsDto;
}

export class PayrollPeriodAttendanceSummaryResponseDto {
  @ApiProperty({ type: PayrollAttendancePeriodInfoDto })
  period!: PayrollAttendancePeriodInfoDto;

  @ApiProperty({ type: PayrollAttendanceFinalizationStateDto })
  finalization!: PayrollAttendanceFinalizationStateDto;

  @ApiProperty({ type: PayrollAttendancePeriodTotalsSummaryDto })
  summary!: PayrollAttendancePeriodTotalsSummaryDto;

  @ApiProperty({ type: [EmployeePayrollAttendanceSummaryDto] })
  employees!: EmployeePayrollAttendanceSummaryDto[];
}
