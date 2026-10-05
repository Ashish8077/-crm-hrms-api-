import { CreateBranchDto } from '../dto/create-branch.dto';
import { UpdateBranchDto } from '../dto/update-branch.dto';
import { Branch } from '../schemas/branch.schema';
import { Types } from 'mongoose';

export interface BranchResponse {
  id: string;
  name: string;
  address?: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export type BranchDocument = Branch & {
  _id: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
};

export class BranchMapper {
  static toCreateData(dto: CreateBranchDto) {
    return {
      name: dto.name,
      address: dto.address,
    };
  }

  static toUpdateData(dto: UpdateBranchDto) {
    return {
      ...(dto.name !== undefined && { name: dto.name }),
      ...(dto.address !== undefined && { address: dto.address }),
    };
  }

  static toUpdateAuditDetails(before: BranchDocument, after: BranchDocument) {
    return {
      changes: {
        ...(before.name !== after.name && {
          name: {
            from: before.name,
            to: after.name,
          },
        }),
        ...(before.address !== after.address && {
          address: {
            from: before.address,
            to: after.address,
          },
        }),
      },
    };
  }

  static toResponse(branch: BranchDocument): BranchResponse {
    return {
      id: branch._id.toString(),
      name: branch.name,
      address: branch.address,
      isActive: branch.isActive,
      createdAt: branch.createdAt,
      updatedAt: branch.updatedAt,
    };
  }
}
