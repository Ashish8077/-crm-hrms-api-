import { IsBoolean, IsNotEmpty } from 'class-validator';

export class UpdateRoleStatusDto {
  @IsBoolean()
  @IsNotEmpty()
  isActive!: boolean;
}
