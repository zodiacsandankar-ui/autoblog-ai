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
import { ImageGeneratorService } from './image-generator.service';
import { GenerateImageDto } from './dto/generate-image.dto';

@ApiTags('Images')
@ApiBearerAuth()
@Controller('images')
export class ImagesController {
  constructor(private readonly imageGenerator: ImageGeneratorService) {}

  @Post('generate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Generate images from a prompt' })
  @ApiResponse({ status: 200, description: 'Images generated successfully' })
  async generate(
    @Body(new ValidationPipe({ transform: true })) dto: GenerateImageDto,
  ) {
    return this.imageGenerator.generate(dto);
  }

  @Get()
  @ApiOperation({ summary: 'Get all generated images' })
  @ApiResponse({ status: 200, description: 'Returns paginated image list' })
  async findAll(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('articleId') articleId?: string,
    @Query('projectId') projectId?: string,
  ) {
    return this.imageGenerator.findAll({
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 50,
      articleId,
      projectId,
    });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a single image by ID' })
  @ApiResponse({ status: 200, description: 'Returns the image' })
  @ApiResponse({ status: 404, description: 'Image not found' })
  async findOne(@Param('id', ParseUUIDPipe) id: string) {
    return this.imageGenerator.findById(id);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete an image' })
  @ApiResponse({ status: 204, description: 'Image deleted' })
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    return this.imageGenerator.deleteImage(id);
  }

  @Post('providers')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get available image providers and their status' })
  @ApiResponse({ status: 200, description: 'Returns providers list' })
  async getProviders() {
    return this.imageGenerator.getProviders();
  }
}
