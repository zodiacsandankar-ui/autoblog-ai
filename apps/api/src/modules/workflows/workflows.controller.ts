import {
  Controller,
  Get,
  Post,
  Put,
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
import { WorkflowEngineService } from './workflow-engine.service';

@ApiTags('Workflows')
@ApiBearerAuth()
@Controller('workflows')
export class WorkflowsController {
  constructor(private readonly workflowEngine: WorkflowEngineService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new workflow' })
  @ApiResponse({ status: 201, description: 'Workflow created' })
  async create(@Body() definition: any) {
    return this.workflowEngine.createWorkflow(definition);
  }

  @Get()
  @ApiOperation({ summary: 'Get all workflows' })
  @ApiResponse({ status: 200, description: 'Returns all workflows' })
  async findAll(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('projectId') projectId?: string,
    @Query('status') status?: string,
    @Query('template') template?: string,
  ) {
    return this.workflowEngine.findAll({
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 20,
      projectId,
      status,
      template,
    });
  }

  @Get('templates')
  @ApiOperation({ summary: 'Get pre-built workflow templates' })
  @ApiResponse({ status: 200, description: 'Returns templates list' })
  async getTemplates() {
    return this.workflowEngine.getTemplates();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a workflow by ID' })
  @ApiResponse({ status: 200, description: 'Returns the workflow' })
  @ApiResponse({ status: 404, description: 'Workflow not found' })
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.workflowEngine.findById(id);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update a workflow' })
  @ApiResponse({ status: 200, description: 'Workflow updated' })
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() definition: any) {
    return this.workflowEngine.updateWorkflow(id, definition);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a workflow' })
  @ApiResponse({ status: 204, description: 'Workflow deleted' })
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.workflowEngine.deleteWorkflow(id);
  }

  @Post(':id/execute')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Execute a workflow' })
  @ApiResponse({ status: 202, description: 'Workflow execution started' })
  async execute(@Param('id', ParseUUIDPipe) id: string) {
    return this.workflowEngine.executeWorkflow(id);
  }

  @Post(':id/stop')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Stop a running workflow' })
  @ApiResponse({ status: 200, description: 'Workflow stopped' })
  async stop(@Param('id', ParseUUIDPipe) id: string) {
    return this.workflowEngine.stopWorkflow(id);
  }

  @Get(':id/runs')
  @ApiOperation({ summary: 'Get execution history for a workflow' })
  @ApiResponse({ status: 200, description: 'Returns execution runs' })
  async getRuns(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.workflowEngine.getRuns(id, {
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 20,
    });
  }
}
