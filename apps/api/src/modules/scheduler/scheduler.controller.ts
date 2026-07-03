import {
  Controller,
  Get,
  Post,
  Delete,
  Param,
  Query,
  Body,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
  ValidationPipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { SchedulerService } from './scheduler.service';
import {
  ScheduleConfigDto,
  OptimalTimesQueryDto,
  CalendarQueryDto,
} from './dto/schedule-config.dto';

@ApiTags('Scheduler')
@ApiBearerAuth()
@Controller('scheduler')
export class SchedulerController {
  constructor(private readonly schedulerService: SchedulerService) {}

  @Post('schedule')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Schedule an article for publishing' })
  @ApiResponse({ status: 201, description: 'Article scheduled successfully' })
  async schedule(
    @Body(new ValidationPipe({ transform: true })) dto: ScheduleConfigDto,
  ) {
    return this.schedulerService.scheduleArticle(dto);
  }

  @Get('calendar')
  @ApiOperation({ summary: 'Get scheduled posts calendar' })
  @ApiResponse({ status: 200, description: 'Returns calendar data' })
  async calendar(
    @Query(new ValidationPipe({ transform: true })) query: CalendarQueryDto,
  ) {
    return this.schedulerService.getCalendar(query);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Cancel a scheduled post' })
  @ApiResponse({ status: 204, description: 'Schedule cancelled' })
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.schedulerService.cancelSchedule(id);
  }

  @Get('optimal-times')
  @ApiOperation({ summary: 'Get optimal publishing times for a project' })
  @ApiResponse({ status: 200, description: 'Returns optimal publishing times' })
  async optimalTimes(
    @Query(new ValidationPipe({ transform: true })) query: OptimalTimesQueryDto,
  ) {
    return this.schedulerService.getOptimalTimes(query.projectId, query.timezone, query.days);
  }

  @Get()
  @ApiOperation({ summary: 'Get all scheduled posts' })
  @ApiResponse({ status: 200, description: 'Returns scheduled posts list' })
  async findAll(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: string,
    @Query('projectId') projectId?: string,
  ) {
    return this.schedulerService.findAll({
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 50,
      status,
      projectId,
    });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a scheduled post by ID' })
  @ApiResponse({ status: 200, description: 'Returns the schedule' })
  @ApiResponse({ status: 404, description: 'Schedule not found' })
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.schedulerService.findById(id);
  }
}
