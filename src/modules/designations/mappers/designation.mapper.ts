import { Types } from 'mongoose';
import { Designation } from '../schemas/designation.schema';
import { CreateDesignationDto } from '../dto/create-designation.dto';
import { UpdateDesignationDto } from '../dto/update-designation.dto';

export type DesignationMapperInput = Designation & {
  _id: Types.ObjectId;
  createdAt?: Date;
  updatedAt?: Date;
};

export interface DesignationResponse {
  id: string;
  name: string;
  description?: string;
  isActive: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

export class DesignationMapper {
  static toCreateData(dto: CreateDesignationDto) {
    return {
      name: dto.name,
      description: dto.description,
    };
  }

  static toUpdateData(dto: UpdateDesignationDto) {
    return {
      ...(dto.name !== undefined && { name: dto.name }),
      ...(dto.description !== undefined && { description: dto.description }),
    };
  }

  static toUpdateAuditDetails(
    before: DesignationMapperInput,
    after: DesignationMapperInput,
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

  static toResponse(designation: DesignationMapperInput): DesignationResponse {
    return {
      id: designation._id.toString(),
      name: designation.name,
      description: designation.description,
      isActive: designation.isActive,
      createdAt: designation.createdAt,
      updatedAt: designation.updatedAt,
    };
  }
}
