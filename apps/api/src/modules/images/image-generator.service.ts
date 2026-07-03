import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { PrismaService } from '../../database/prisma.service';
import { DeepSeekService } from '../../ai/providers/deepseek.service';
import { GenerateImageDto, GenerateImageOptionsDto, ImageProvider, ImageStyle, ImageAspectRatio } from './dto/generate-image.dto';
import { firstValueFrom } from 'rxjs';
import * as sharp from 'sharp';
import * as path from 'path';
import * as fs from 'fs/promises';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class ImageGeneratorService {
  private readonly logger = new Logger(ImageGeneratorService.name);

  private readonly PROVIDER_CHAIN: ImageProvider[] = [
    ImageProvider.DALLE3,
    ImageProvider.MIDJOURNEY,
    ImageProvider.STABLE_DIFFUSION,
    ImageProvider.LEONARDO,
    ImageProvider.IDEOGRAM,
    ImageProvider.FIREFLY,
  ];

  private readonly VARIANT_SIZES = {
    thumbnail: { width: 150, height: 150 },
    medium: { width: 640, height: 480 },
    large: { width: 1200, height: 800 },
    og: { width: 1200, height: 630 },
    pinterest: { width: 1000, height: 1500 },
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly httpService: HttpService,
    private readonly deepseek: DeepSeekService,
  ) {}

  async generate(dto: GenerateImageDto): Promise<any> {
    this.logger.log(`Generating image for prompt: ${dto.prompt.substring(0, 50)}...`);

    const options = dto.options || {};
    const optimizedPrompt = await this.generateOptimizedPrompt(dto.prompt, options);
    const providerChain = options.providerChain || this.PROVIDER_CHAIN;

    let imageUrl: string | null = null;
    let usedProvider: ImageProvider = providerChain[0];
    let imageBuffer: Buffer | null = null;

    for (const provider of providerChain) {
      try {
        this.logger.log(`Trying provider: ${provider}`);
        const result = await this.tryProvider(provider, optimizedPrompt, options);
        if (result?.url) {
          imageUrl = result.url;
          usedProvider = provider;
          imageBuffer = result.buffer || null;
          this.logger.log(`Provider ${provider} succeeded`);
          break;
        }
      } catch (error) {
        this.logger.warn(`Provider ${provider} failed: ${error.message}`);
      }
    }

    if (!imageUrl) {
      throw new BadRequestException('All image providers failed to generate an image');
    }

    let cdnUrl = imageUrl;
    let variants = {};
    let webpUrl: string | null = null;
    let avifUrl: string | null = null;

    if (options.uploadToCDN !== false && imageBuffer) {
      cdnUrl = await this.uploadToCDN(imageBuffer, `image-${uuidv4()}`, 'images');

      if (options.generateVariants !== false) {
        const variantConfig = options.variants || {};
        variants = await this.generateVariants(imageBuffer, variantConfig);
      }

      if (options.webp !== false) {
        webpUrl = await this.convertToWebP(imageBuffer);
      }

      if (options.avif) {
        avifUrl = await this.convertToAVIF(imageBuffer);
      }
    }

    const saved = await this.prisma.image.create({
      data: {
        url: cdnUrl,
        thumbnailUrl: (variants as any).thumbnail || null,
        mediumUrl: (variants as any).medium || null,
        largeUrl: (variants as any).large || null,
        ogUrl: (variants as any).og || null,
        pinterestUrl: (variants as any).pinterest || null,
        webpUrl,
        avifUrl,
        prompt: dto.prompt,
        optimizedPrompt,
        provider: usedProvider,
        style: options.style || ImageStyle.REALISTIC,
        width: this.getWidthForAspectRatio(options.aspectRatio),
        height: this.getHeightForAspectRatio(options.aspectRatio),
        format: webpUrl ? 'webp' : 'png',
        size: imageBuffer?.length || 0,
        alt: this.generateAltText(dto.prompt),
        articleId: dto.articleId || null,
        projectId: dto.projectId || null,
      },
    });

    return {
      ...saved,
      variants,
    };
  }

  private async generateOptimizedPrompt(
    userPrompt: string,
    options: GenerateImageOptionsDto,
  ): Promise<string> {
    try {
      const response = await this.deepseek.complete({
        model: 'deepseek-chat',
        messages: [
          {
            role: 'system',
            content: 'You are an expert image prompt engineer. Create detailed, optimized image generation prompts. Return ONLY the prompt text, nothing else.',
          },
          {
            role: 'user',
            content: this.buildPromptEnhancementRequest(userPrompt, options),
          },
        ],
        temperature: 0.7,
        max_tokens: 500,
      });

      const enhanced = response.choices[0].message.content.trim();
      return enhanced || userPrompt;
    } catch (error) {
      this.logger.warn(`Prompt enhancement failed: ${error.message}, using original`);
      return userPrompt;
    }
  }

  private buildPromptEnhancementRequest(prompt: string, options: GenerateImageOptionsDto): string {
    const parts = [
      `Original prompt: "${prompt}"`,
      `Style: ${options.style || 'realistic'}`,
      `Aspect ratio: ${options.aspectRatio || '16:9'}`,
    ];
    if (options.negativePrompt) {
      parts.push(`Avoid: ${options.negativePrompt}`);
    }
    parts.push('\nEnhance this into a detailed, vivid image generation prompt.');
    return parts.join('\n');
  }

  private async tryProvider(
    provider: ImageProvider,
    prompt: string,
    options: GenerateImageOptionsDto,
  ): Promise<{ url: string; buffer?: Buffer } | null> {
    switch (provider) {
      case ImageProvider.DALLE3:
        return this.callDalle3(prompt, options);
      case ImageProvider.STABLE_DIFFUSION:
        return this.callStableDiffusion(prompt, options);
      case ImageProvider.LEONARDO:
        return this.callLeonardo(prompt, options);
      case ImageProvider.IDEOGRAM:
        return this.callIdeogram(prompt, options);
      case ImageProvider.FIREFLY:
        return this.callFirefly(prompt, options);
      case ImageProvider.MIDJOURNEY:
        return this.callMidjourney(prompt, options);
      default:
        return null;
    }
  }

  private async callDalle3(prompt: string, options: GenerateImageOptionsDto): Promise<{ url: string; buffer?: Buffer } | null> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) return null;

    try {
      const size = options.size || '1024x1024';
      const response = await firstValueFrom(
        this.httpService.post(
          'https://api.openai.com/v1/images/generations',
          {
            model: 'dall-e-3',
            prompt,
            n: 1,
            size,
            quality: 'hd',
            response_format: 'url',
          },
          {
            headers: {
              Authorization: `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
            },
            timeout: 60000,
          },
        ),
      );

      const url = response.data?.data?.[0]?.url;
      if (!url) return null;

      const imgResponse = await firstValueFrom(
        this.httpService.get(url, { responseType: 'arraybuffer', timeout: 30000 }),
      );
      return { url, buffer: Buffer.from(imgResponse.data) };
    } catch (error) {
      this.logger.warn(`DALL-E 3 failed: ${error.message}`);
      return null;
    }
  }

  private async callStableDiffusion(prompt: string, options: GenerateImageOptionsDto): Promise<{ url: string; buffer?: Buffer } | null> {
    const apiKey = process.env.STABILITY_API_KEY;
    if (!apiKey) return null;

    try {
      const response = await firstValueFrom(
        this.httpService.post(
          'https://api.stability.ai/v1/generation/stable-diffusion-xl-1024-v1-0/text-to-image',
          {
            text_prompts: [{ text: prompt, weight: 1 }],
            cfg_scale: 7,
            height: this.getHeightForAspectRatio(options.aspectRatio) || 1024,
            width: this.getWidthForAspectRatio(options.aspectRatio) || 1024,
            samples: 1,
            steps: 30,
          },
          {
            headers: {
              Authorization: `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
              Accept: 'application/json',
            },
            timeout: 60000,
          },
        ),
      );

      const base64 = response.data?.artifacts?.[0]?.base64;
      if (!base64) return null;

      const buffer = Buffer.from(base64, 'base64');
      const tempUrl = `data:image/png;base64,${base64}`;
      return { url: tempUrl, buffer };
    } catch (error) {
      this.logger.warn(`Stable Diffusion failed: ${error.message}`);
      return null;
    }
  }

  private async callLeonardo(prompt: string, options: GenerateImageOptionsDto): Promise<{ url: string; buffer?: Buffer } | null> {
    const apiKey = process.env.LEONARDO_API_KEY;
    if (!apiKey) return null;

    try {
      const generationResponse = await firstValueFrom(
        this.httpService.post(
          'https://cloud.leonardo.ai/api/rest/v1/generations',
          {
            height: this.getHeightForAspectRatio(options.aspectRatio) || 1024,
            width: this.getWidthForAspectRatio(options.aspectRatio) || 1024,
            modelId: '6bef9f1b-29cb-40c7-b9df-32b51c1f67d3',
            num_images: 1,
            prompt,
            presetStyle: options.style === ImageStyle.CINEMATIC ? 'CINEMATIC' : 'DYNAMIC',
            sd_version: 'v1_5',
            seed: options.seed,
          },
          {
            headers: {
              Authorization: `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
              Accept: 'application/json',
            },
            timeout: 120000,
          },
        ),
      );

      const generationId = generationResponse.data?.sdGenerationJob?.generationId;
      if (!generationId) return null;

      await this.sleep(5000);
      for (let attempt = 0; attempt < 10; attempt++) {
        const resultResponse = await firstValueFrom(
          this.httpService.get(
            `https://cloud.leonardo.ai/api/rest/v1/generations/${generationId}`,
            {
              headers: { Authorization: `Bearer ${apiKey}` },
              timeout: 30000,
            },
          ),
        );

        const images = resultResponse.data?.generations_by_pk?.generated_images;
        if (images?.length > 0) {
          const url = images[0].url;
          const imgResponse = await firstValueFrom(
            this.httpService.get(url, { responseType: 'arraybuffer', timeout: 30000 }),
          );
          return { url, buffer: Buffer.from(imgResponse.data) };
        }
        await this.sleep(3000);
      }
      return null;
    } catch (error) {
      this.logger.warn(`Leonardo AI failed: ${error.message}`);
      return null;
    }
  }

  private async callIdeogram(prompt: string, options: GenerateImageOptionsDto): Promise<{ url: string; buffer?: Buffer } | null> {
    const apiKey = process.env.IDEOGRAM_API_KEY;
    if (!apiKey) return null;

    try {
      const response = await firstValueFrom(
        this.httpService.post(
          'https://api.ideogram.ai/generate',
          {
            image_request: {
              prompt,
              aspect_ratio: options.aspectRatio || '16:9',
              model: 'V_2',
              magic_prompt_option: 'AUTO',
              num_images: 1,
            },
          },
          {
            headers: {
              'Api-Key': apiKey,
              'Content-Type': 'application/json',
            },
            timeout: 120000,
          },
        ),
      );

      const url = response.data?.data?.[0]?.url;
      if (!url) return null;

      const imgResponse = await firstValueFrom(
        this.httpService.get(url, { responseType: 'arraybuffer', timeout: 30000 }),
      );
      return { url, buffer: Buffer.from(imgResponse.data) };
    } catch (error) {
      this.logger.warn(`Ideogram failed: ${error.message}`);
      return null;
    }
  }

  private async callFirefly(prompt: string, options: GenerateImageOptionsDto): Promise<{ url: string; buffer?: Buffer } | null> {
    const clientId = process.env.FIREFLY_CLIENT_ID;
    const clientSecret = process.env.FIREFLY_CLIENT_SECRET;
    if (!clientId || !clientSecret) return null;

    try {
      const tokenResponse = await firstValueFrom(
        this.httpService.post(
          'https://ims-na1.adobelogin.com/ims/token/v3',
          new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            grant_type: 'client_credentials',
            scope: 'openid,AdobeID,firefly_enterprise,firefly_api',
          }).toString(),
          {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            timeout: 15000,
          },
        ),
      );

      const accessToken = tokenResponse.data?.access_token;
      if (!accessToken) return null;

      const generateResponse = await firstValueFrom(
        this.httpService.post(
          'https://firefly-api.adobe.io/v3/images/generate',
          {
            numVariations: 1,
            prompt,
            size: { width: this.getWidthForAspectRatio(options.aspectRatio) || 1024, height: this.getHeightForAspectRatio(options.aspectRatio) || 1024 },
          },
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'x-api-key': clientId,
              'Content-Type': 'application/json',
            },
            timeout: 60000,
          },
        ),
      );

      const url = generateResponse.data?.outputs?.[0]?.image?.url;
      if (!url) return null;

      const imgResponse = await firstValueFrom(
        this.httpService.get(url, { responseType: 'arraybuffer', timeout: 30000 }),
      );
      return { url, buffer: Buffer.from(imgResponse.data) };
    } catch (error) {
      this.logger.warn(`Firefly failed: ${error.message}`);
      return null;
    }
  }

  private async callMidjourney(prompt: string, options: GenerateImageOptionsDto): Promise<{ url: string; buffer?: Buffer } | null> {
    const apiKey = process.env.MIDJOURNEY_API_KEY;
    const apiUrl = process.env.MIDJOURNEY_API_URL || 'https://api.midjourney.ai/v1';
    if (!apiKey) return null;

    try {
      const response = await firstValueFrom(
        this.httpService.post(
          `${apiUrl}/imagine`,
          {
            prompt,
            aspect_ratio: options.aspectRatio || '1:1',
            process_mode: 'fast',
            seed: options.seed,
          },
          {
            headers: {
              Authorization: `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
            },
            timeout: 120000,
          },
        ),
      );

      const messageId = response.data?.messageId;
      if (!messageId) return null;

      for (let attempt = 0; attempt < 15; attempt++) {
        const statusResponse = await firstValueFrom(
          this.httpService.get(`${apiUrl}/message/${messageId}`, {
            headers: { Authorization: `Bearer ${apiKey}` },
            timeout: 30000,
          }),
        );

        if (statusResponse.data?.progress === 100 && statusResponse.data?.uri) {
          const imgResponse = await firstValueFrom(
            this.httpService.get(statusResponse.data.uri, { responseType: 'arraybuffer', timeout: 30000 }),
          );
          return { url: statusResponse.data.uri, buffer: Buffer.from(imgResponse.data) };
        }
        await this.sleep(5000);
      }
      return null;
    } catch (error) {
      this.logger.warn(`Midjourney failed: ${error.message}`);
      return null;
    }
  }

  async uploadToCDN(buffer: Buffer, filename: string, folder: string): Promise<string> {
    const s3Region = process.env.S3_REGION || 'us-east-1';
    const s3Bucket = process.env.S3_BUCKET;
    const s3Endpoint = process.env.S3_ENDPOINT;
    const cdnBaseUrl = process.env.CDN_BASE_URL || 'https://cdn.autoblog.ai';

    if (s3Bucket) {
      try {
        const { S3Client, PutObjectCommand } = await import('@aws-sdk/client-s3');
        const s3Client = new S3Client({
          region: s3Region,
          endpoint: s3Endpoint || undefined,
          credentials: {
            accessKeyId: process.env.S3_ACCESS_KEY_ID || '',
            secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || '',
          },
          forcePathStyle: !s3Endpoint?.includes('amazonaws.com'),
        });

        const key = `${folder}/${filename}.webp`;
        await s3Client.send(
          new PutObjectCommand({
            Bucket: s3Bucket,
            Key: key,
            Body: buffer,
            ContentType: 'image/webp',
            CacheControl: 'public, max-age=31536000, immutable',
          }),
        );

        const url = s3Endpoint
          ? `${s3Endpoint}/${s3Bucket}/${key}`
          : `${cdnBaseUrl}/${key}`;
        this.logger.log(`Uploaded to CDN: ${url}`);
        return url;
      } catch (error) {
        this.logger.warn(`S3 upload failed: ${error.message}, saving locally`);
      }
    }

    const localDir = path.join(process.cwd(), 'uploads', folder);
    await fs.mkdir(localDir, { recursive: true });
    const localPath = path.join(localDir, `${filename}.webp`);
    await fs.writeFile(localPath, buffer);
    this.logger.log(`Saved locally: ${localPath}`);
    return `${cdnBaseUrl}/${folder}/${filename}.webp`;
  }

  async generateVariants(
    buffer: Buffer,
    config: Record<string, boolean>,
  ): Promise<Record<string, string>> {
    const variants: Record<string, string> = {};
    const variantConfig = {
      thumbnail: config.thumbnail !== false,
      medium: config.medium !== false,
      large: config.large !== false,
      og: config.og !== false,
      pinterest: config.pinterest === true,
    };

    for (const [name, enabled] of Object.entries(variantConfig)) {
      if (!enabled) continue;
      try {
        const size = this.VARIANT_SIZES[name];
        const resized = await this.resizeImage(buffer, size.width, size.height);
        const webpBuffer = await sharp(resized).webp({ quality: 80 }).toBuffer();
        const url = await this.uploadToCDN(webpBuffer, `${name}-${uuidv4()}`, 'images/variants');
        variants[name] = url;
      } catch (error) {
        this.logger.warn(`Failed to generate ${name} variant: ${error.message}`);
      }
    }

    return variants;
  }

  async resizeImage(buffer: Buffer, width: number, height: number): Promise<Buffer> {
    return sharp(buffer)
      .resize(width, height, {
        fit: 'cover',
        position: 'center',
        withoutEnlargement: true,
      })
      .toBuffer();
  }

  async convertToWebP(buffer: Buffer, quality: number = 80): Promise<string> {
    const webpBuffer = await sharp(buffer).webp({ quality }).toBuffer();
    return this.uploadToCDN(webpBuffer, `webp-${uuidv4()}`, 'images/webp');
  }

  async convertToAVIF(buffer: Buffer, quality: number = 70): Promise<string> {
    const avifBuffer = await sharp(buffer).avif({ quality }).toBuffer();
    return this.uploadToCDN(avifBuffer, `avif-${uuidv4()}`, 'images/avif');
  }

  async findAll(filter: { page: number; limit: number; articleId?: string; projectId?: string }): Promise<{ data: any[]; total: number }> {
    const where: any = {};
    if (filter.articleId) where.articleId = filter.articleId;
    if (filter.projectId) where.projectId = filter.projectId;

    const [data, total] = await Promise.all([
      this.prisma.image.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (filter.page - 1) * filter.limit,
        take: filter.limit,
      }),
      this.prisma.image.count({ where }),
    ]);

    return { data, total };
  }

  async findById(id: string): Promise<any> {
    const image = await this.prisma.image.findUnique({ where: { id } });
    if (!image) throw new NotFoundException(`Image ${id} not found`);
    return image;
  }

  async deleteImage(id: string): Promise<void> {
    const image = await this.findById(id);
    await this.prisma.image.delete({ where: { id } });
    this.logger.log(`Deleted image ${id}`);
  }

  async getProviders(): Promise<any[]> {
    return this.PROVIDER_CHAIN.map((provider) => ({
      name: provider,
      configured: this.isProviderConfigured(provider),
      enabled: true,
    }));
  }

  private isProviderConfigured(provider: ImageProvider): boolean {
    switch (provider) {
      case ImageProvider.DALLE3: return !!process.env.OPENAI_API_KEY;
      case ImageProvider.STABLE_DIFFUSION: return !!process.env.STABILITY_API_KEY;
      case ImageProvider.LEONARDO: return !!process.env.LEONARDO_API_KEY;
      case ImageProvider.IDEOGRAM: return !!process.env.IDEOGRAM_API_KEY;
      case ImageProvider.FIREFLY: return !!(process.env.FIREFLY_CLIENT_ID && process.env.FIREFLY_CLIENT_SECRET);
      case ImageProvider.MIDJOURNEY: return !!process.env.MIDJOURNEY_API_KEY;
      default: return false;
    }
  }

  private getWidthForAspectRatio(ratio?: ImageAspectRatio): number {
    switch (ratio) {
      case ImageAspectRatio.SQUARE: return 1024;
      case ImageAspectRatio.LANDSCAPE: return 1792;
      case ImageAspectRatio.PORTRAIT: return 1024;
      case ImageAspectRatio.WIDE: return 1280;
      case ImageAspectRatio.TALL: return 768;
      case ImageAspectRatio.BANNER: return 1792;
      default: return 1024;
    }
  }

  private getHeightForAspectRatio(ratio?: ImageAspectRatio): number {
    switch (ratio) {
      case ImageAspectRatio.SQUARE: return 1024;
      case ImageAspectRatio.LANDSCAPE: return 1024;
      case ImageAspectRatio.PORTRAIT: return 1792;
      case ImageAspectRatio.WIDE: return 960;
      case ImageAspectRatio.TALL: return 1024;
      case ImageAspectRatio.BANNER: return 768;
      default: return 1024;
    }
  }

  private generateAltText(prompt: string): string {
    return prompt
      .replace(/[\\\/\<\>\&\"]/g, '')
      .substring(0, 125)
      .trim();
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
