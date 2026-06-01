import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  listUsers() {
    return this.usersService.listUsers();
  }

  @Get(':userId')
  async getUser(@Param('userId') userId: string) {
    const user = await this.usersService.findById(userId);
    if (user === null) throw new NotFoundException(`User ${userId} not found`);
    return user;
  }

  @Post()
  createUser(@Body() dto: CreateUserDto) {
    return this.usersService.createUser(dto);
  }

  @Patch(':userId')
  async updateUser(
    @Param('userId') userId: string,
    @Body() dto: UpdateUserDto,
  ) {
    const user = await this.usersService.findById(userId);
    if (user === null) throw new NotFoundException(`User ${userId} not found`);
    return this.usersService.updateUser(userId, dto);
  }

  @Delete(':userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteUser(@Param('userId') userId: string) {
    const user = await this.usersService.findById(userId);
    if (user === null) throw new NotFoundException(`User ${userId} not found`);
    await this.usersService.deleteUser(userId);
  }
}
