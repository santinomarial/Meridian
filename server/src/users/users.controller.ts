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
import { SkipThrottle } from '@nestjs/throttler';
import {
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { UsersService } from './users.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';

@SkipThrottle({ auth: true })
@ApiTags('users')
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @ApiOperation({ summary: 'List all users' })
  @ApiOkResponse({ description: 'Array of users' })
  listUsers() {
    return this.usersService.listUsers();
  }

  @Get(':userId')
  @ApiOperation({ summary: 'Get a user by id' })
  @ApiParam({ name: 'userId', description: 'User cuid' })
  @ApiOkResponse({ description: 'The user' })
  @ApiNotFoundResponse({ description: 'User not found' })
  async getUser(@Param('userId') userId: string) {
    const user = await this.usersService.findById(userId);
    if (user === null) throw new NotFoundException(`User ${userId} not found`);
    return user;
  }

  @Post()
  @ApiOperation({ summary: 'Create a user' })
  @ApiCreatedResponse({ description: 'The created user' })
  createUser(@Body() dto: CreateUserDto) {
    return this.usersService.createUser(dto);
  }

  @Patch(':userId')
  @ApiOperation({ summary: 'Update a user' })
  @ApiParam({ name: 'userId', description: 'User cuid' })
  @ApiOkResponse({ description: 'The updated user' })
  @ApiNotFoundResponse({ description: 'User not found' })
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
  @ApiOperation({ summary: 'Delete a user' })
  @ApiParam({ name: 'userId', description: 'User cuid' })
  @ApiNoContentResponse({ description: 'User deleted' })
  @ApiNotFoundResponse({ description: 'User not found' })
  async deleteUser(@Param('userId') userId: string) {
    const user = await this.usersService.findById(userId);
    if (user === null) throw new NotFoundException(`User ${userId} not found`);
    await this.usersService.deleteUser(userId);
  }
}
