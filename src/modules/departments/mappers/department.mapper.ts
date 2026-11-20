import { Types } from 'mongoose';
import { Department } from '../schemas/department.schema';
import { CreateDepartmentDto } from '../dto/create-department.dto';
import { UpdateDepartmentDto } from '../dto/update-department.dto';

export type DepartmentMapperInput = Department & {
  _id: Types.ObjectId;
  createdAt?: Date;
  updatedAt?: Date;
};

export interface DepartmentResponse {
  id: string;
  name: string;
  description?: string;
  isActive: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

export class DepartmentMapper {
  static toCreateData(dto: CreateDepartmentDto) {
    return {
      name: dto.name,
      description: dto.description,
    };
  }

  static toUpdateData(dto: UpdateDepartmentDto) {
    return {
      ...(dto.name !== undefined && { name: dto.name }),
      ...(dto.description !== undefined && { description: dto.description }),
    };
  }

  static toUpdateAuditDetails(
    before: DepartmentMapperInput,
    after: DepartmentMapperInput,
  ) {
    return {
      changes: {
        ...(before.name !== after.name && {
          name: { from: before.name, to: after.name },
        }),
        ...(before.description !== after.description && {
          description: { from: before.description, to: after.description },
        }),
      },
    };
  }

  static toResponse(department: DepartmentMapperInput): DepartmentResponse {
    return {
      id: department._id.toString(),
      name: department.name,
      description: department.description,
      isActive: department.isActive,
      createdAt: department.createdAt,
      updatedAt: department.updatedAt,
    };
  }
}
