import { Injectable } from '@nestjs/common';
import { Model, Types } from 'mongoose';
import { User } from '../schemas/user.schema';
import { InjectModel } from '@nestjs/mongoose';

@Injectable()
export class UserRepository {
  constructor(
    @InjectModel(User.name)
    private readonly userModel: Model<User>,
  ) {}

  async findByEmail(
    email: string,
  ): Promise<(User & { _id: Types.ObjectId }) | null> {
    return this.userModel.findOne({ email }).select('+passwordHash').lean();
  }

  async updateLastLoginAt(userId: Types.ObjectId): Promise<void> {
    await this.userModel
      .updateOne({ _id: userId }, { $set: { lastLoginAt: new Date() } })
      .exec();
  }
}
