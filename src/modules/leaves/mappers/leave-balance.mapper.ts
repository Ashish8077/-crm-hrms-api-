import { LeaveBalanceLean } from '../repositories/leave-balance.repository';
import { LeaveTransactionLean } from '../repositories/leave-transaction.repository';

export interface LeaveBalanceResponse {
  id: string;
  employeeId: string;
  leaveTypeId: string;
  year: number;
  allocatedDays: number;
  carriedForwardDays: number;
  creditedDays: number;
  debitedDays: number;
  pendingDays: number;
  usedDays: number;
  availableBalance: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface LeaveTransactionResponse {
  id: string;
  employeeId: string;
  leaveTypeId: string;
  year: number;
  transactionType: string;
  days: number;
  previousAvailable: number;
  newAvailable: number;
  referenceId: string | null;
  referenceType?: string;
  remarks?: string;
  actorId: string;
  createdAt?: string;
}

export class LeaveBalanceMapper {
  static toResponse(doc: LeaveBalanceLean): LeaveBalanceResponse {
    return {
      id: doc._id.toString(),
      employeeId: doc.employeeId.toString(),
      leaveTypeId: doc.leaveTypeId.toString(),
      year: doc.year,
      allocatedDays: doc.allocatedDays,
      carriedForwardDays: doc.carriedForwardDays,
      creditedDays: doc.creditedDays,
      debitedDays: doc.debitedDays,
      pendingDays: doc.pendingDays,
      usedDays: doc.usedDays,
      availableBalance: doc.availableBalance,
      createdAt: doc.createdAt?.toISOString(),
      updatedAt: doc.updatedAt?.toISOString(),
    };
  }

  static toResponseList(docs: LeaveBalanceLean[]): LeaveBalanceResponse[] {
    return docs.map((d) => this.toResponse(d));
  }

  static toTransactionResponse(
    doc: LeaveTransactionLean,
  ): LeaveTransactionResponse {
    return {
      id: doc._id.toString(),
      employeeId: doc.employeeId.toString(),
      leaveTypeId: doc.leaveTypeId.toString(),
      year: doc.year,
      transactionType: doc.transactionType,
      days: doc.days,
      previousAvailable: doc.previousAvailable,
      newAvailable: doc.newAvailable,
      referenceId: doc.referenceId ? doc.referenceId.toString() : null,
      referenceType: doc.referenceType,
      remarks: doc.remarks,
      actorId: doc.actorId.toString(),
      createdAt: doc.createdAt?.toISOString(),
    };
  }

  static toTransactionResponseList(
    docs: LeaveTransactionLean[],
  ): LeaveTransactionResponse[] {
    return docs.map((d) => this.toTransactionResponse(d));
  }
}
