import { Controller, Put, Param, Body, Req } from '@nestjs/common';
import { Types } from 'mongoose';
import { UsersService } from './users.service';
import { AssignRolesDto } from './dto/assign-roles.dto';
import type { AuthenticatedRequest } from '../auth/types/auth-request.type';

@Controller({
  path: 'users',
  version: '1',
})
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Put(':id/roles')
  async assignRoles(
    @Param('id') id: string,
    @Body() assignRolesDto: AssignRolesDto,
    @Req() request: AuthenticatedRequest,
  ) {
    const ipAddress = request.ip ?? null;
    const userAgent = request.headers['user-agent'] ?? null;
    await this.usersService.assignRoles(
      new Types.ObjectId(id),
      assignRolesDto,
      request.user.userId,
      { ipAddress, userAgent },
    );
    return { success: true, message: 'Roles assigned successfully' };
  }
}
