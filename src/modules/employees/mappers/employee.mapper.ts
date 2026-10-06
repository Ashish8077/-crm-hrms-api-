import { Types } from 'mongoose';
import { Employee } from '../schemas/employee.schema';
import { CreateEmployeeDto } from '../dto/create-employee.dto';
import { UpdateEmployeeDto } from '../dto/update-employee.dto';

export type EmployeeMapperInput = Employee & { _id: Types.ObjectId };

export interface EmployeeResponse {
  id: string;
  userId: string | null;
  employeeCode: string;
  firstName: string;
  lastName: string;
  workEmail: string;
  phoneNumber?: string;
  dateOfBirth?: Date;
  dateOfJoining: Date;
  departmentId: string;
  designationId: string;
  branchId: string;
  teamId: string | null;
  reportingManagerId: string | null;
  employmentType: string;
  employmentStatus: string;
  emergencyContact?: Record<string, any> | null;
  skills: string[];
  certifications: string[];
  createdAt?: Date;
  updatedAt?: Date;
}

export class EmployeeMapper {
  static toResponse(employee: EmployeeMapperInput): EmployeeResponse {
    return {
      id: employee._id.toString(),
      userId: employee.userId?.toString() ?? null,
      employeeCode: employee.employeeCode,
      firstName: employee.firstName,
      lastName: employee.lastName,
      workEmail: employee.workEmail,
      phoneNumber: employee.phoneNumber,
      dateOfBirth: employee.dateOfBirth,
      dateOfJoining: employee.dateOfJoining,
      departmentId: employee.departmentId.toString(),
      designationId: employee.designationId.toString(),
      branchId: employee.branchId.toString(),
      teamId: employee.teamId?.toString() ?? null,
      reportingManagerId: employee.reportingManagerId?.toString() ?? null,
      employmentType: employee.employmentType,
      employmentStatus: employee.employmentStatus,
      emergencyContact: employee.emergencyContact ?? null,
      skills: employee.skills ?? [],
      certifications: employee.certifications ?? [],
      createdAt: employee.createdAt,
      updatedAt: employee.updatedAt,
    };
  }

  static toCreateData(dto: CreateEmployeeDto): Partial<Employee> {
    return {
      firstName: dto.firstName,
      lastName: dto.lastName,
      workEmail: dto.workEmail,
      phoneNumber: dto.phoneNumber,
      dateOfBirth: dto.dateOfBirth,
      dateOfJoining: dto.dateOfJoining,
      departmentId: new Types.ObjectId(dto.departmentId),
      designationId: new Types.ObjectId(dto.designationId),
      branchId: new Types.ObjectId(dto.branchId),
      teamId: dto.teamId ? new Types.ObjectId(dto.teamId) : null,
      reportingManagerId: dto.reportingManagerId
        ? new Types.ObjectId(dto.reportingManagerId)
        : null,
      employmentType: dto.employmentType,
      employmentStatus: dto.employmentStatus,
      bankDetails: dto.bankDetails,
      emergencyContact: dto.emergencyContact,
      skills: dto.skills ?? [],
      certifications: dto.certifications ?? [],
    };
  }

  static toUpdateData(dto: UpdateEmployeeDto): Record<string, unknown> {
    const data: Record<string, unknown> = {};

    if (dto.firstName !== undefined) data.firstName = dto.firstName;
    if (dto.lastName !== undefined) data.lastName = dto.lastName;
    if (dto.workEmail !== undefined) data.workEmail = dto.workEmail;
    if (dto.phoneNumber !== undefined) data.phoneNumber = dto.phoneNumber;
    if (dto.dateOfBirth !== undefined) data.dateOfBirth = dto.dateOfBirth;
    if (dto.dateOfJoining !== undefined) data.dateOfJoining = dto.dateOfJoining;
    if (dto.departmentId !== undefined)
      data.departmentId = new Types.ObjectId(dto.departmentId);
    if (dto.designationId !== undefined)
      data.designationId = new Types.ObjectId(dto.designationId);
    if (dto.branchId !== undefined)
      data.branchId = new Types.ObjectId(dto.branchId);
    if (dto.teamId !== undefined)
      data.teamId = dto.teamId ? new Types.ObjectId(dto.teamId) : null;
    if (dto.reportingManagerId !== undefined)
      data.reportingManagerId = dto.reportingManagerId
        ? new Types.ObjectId(dto.reportingManagerId)
        : null;
    if (dto.employmentType !== undefined)
      data.employmentType = dto.employmentType;
    if (dto.employmentStatus !== undefined)
      data.employmentStatus = dto.employmentStatus;
    if (dto.bankDetails !== undefined) data.bankDetails = dto.bankDetails;
    if (dto.emergencyContact !== undefined)
      data.emergencyContact = dto.emergencyContact;
    if (dto.skills !== undefined) data.skills = dto.skills;
    if (dto.certifications !== undefined)
      data.certifications = dto.certifications;

    return data;
  }

  static toUpdateAuditDetails(
    before: EmployeeMapperInput,
    after: EmployeeMapperInput,
  ): Record<string, unknown> {
    return {
      before: EmployeeMapper.toResponse(before),
      after: EmployeeMapper.toResponse(after),
    };
  }
}
