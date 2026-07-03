import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Readable } from 'stream';

export interface StorageUploadOptions {
  buffer: Buffer;
  key: string;
  contentType?: string;
  metadata?: Record<string, string>;
  isPublic?: boolean;
}

export interface StorageResult {
  url: string;
  key: string;
  size: number;
  contentType?: string;
}

@Injectable()
export class StorageService {
  private readonly s3Client: S3Client;
  private readonly bucket: string;
  private readonly cdnUrl: string;
  private readonly logger = new Logger(StorageService.name);

  constructor(private readonly configService: ConfigService) {
    this.bucket = configService.get<string>('S3_BUCKET', 'autoblog-assets');
    this.cdnUrl = configService.get<string>('S3_CDN_URL', '');

    this.s3Client = new S3Client({
      region: configService.get<string>('S3_REGION', 'us-east-1'),
      endpoint: configService.get<string>('S3_ENDPOINT'),
      forcePathStyle: true,
      credentials: {
        accessKeyId: configService.get<string>('S3_ACCESS_KEY', ''),
        secretAccessKey: configService.get<string>('S3_SECRET_KEY', ''),
      },
    });
  }

  async upload(options: StorageUploadOptions): Promise<StorageResult> {
    try {
      const command = new PutObjectCommand({
        Bucket: this.bucket,
        Key: options.key,
        Body: options.buffer,
        ContentType: options.contentType || 'application/octet-stream',
        Metadata: options.metadata,
        ACL: options.isPublic ? 'public-read' : 'private',
        CacheControl: 'public, max-age=31536000, immutable',
      });

      await this.s3Client.send(command);

      const url = this.cdnUrl
        ? `${this.cdnUrl}/${options.key}`
        : await this.getSignedUrl(options.key);

      this.logger.debug(`File uploaded: ${options.key} (${options.buffer.length} bytes)`);

      return {
        url,
        key: options.key,
        size: options.buffer.length,
        contentType: options.contentType,
      };
    } catch (error) {
      this.logger.error(`Failed to upload ${options.key}:`, error);
      throw new Error(`Storage upload failed: ${error.message}`);
    }
  }

  async uploadStream(
    stream: Readable,
    key: string,
    contentType?: string,
  ): Promise<StorageResult> {
    try {
      const upload = new Upload({
        client: this.s3Client,
        params: {
          Bucket: this.bucket,
          Key: key,
          Body: stream,
          ContentType: contentType || 'application/octet-stream',
          CacheControl: 'public, max-age=31536000, immutable',
        },
      });

      const result = await upload.done();

      const url = this.cdnUrl
        ? `${this.cdnUrl}/${key}`
        : await this.getSignedUrl(key);

      return {
        url,
        key,
        size: 0,
        contentType,
      };
    } catch (error) {
      this.logger.error(`Failed to upload stream ${key}:`, error);
      throw new Error(`Storage stream upload failed: ${error.message}`);
    }
  }

  async download(key: string): Promise<Buffer> {
    try {
      const command = new GetObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });
      const response = await this.s3Client.send(command);
      const stream = response.Body as Readable;
      return await this.streamToBuffer(stream);
    } catch (error) {
      this.logger.error(`Failed to download ${key}:`, error);
      throw new Error(`Storage download failed: ${error.message}`);
    }
  }

  async delete(key: string): Promise<void> {
    try {
      const command = new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });
      await this.s3Client.send(command);
      this.logger.debug(`File deleted: ${key}`);
    } catch (error) {
      this.logger.error(`Failed to delete ${key}:`, error);
    }
  }

  async deleteMany(prefix: string): Promise<void> {
    try {
      const listCommand = new ListObjectsV2Command({
        Bucket: this.bucket,
        Prefix: prefix,
      });
      const listResult = await this.s3Client.send(listCommand);

      if (listResult.Contents && listResult.Contents.length > 0) {
        for (const obj of listResult.Contents) {
          if (obj.Key) {
            await this.delete(obj.Key);
          }
        }
      }
    } catch (error) {
      this.logger.error(`Failed to delete objects with prefix ${prefix}:`, error);
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      const command = new HeadObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });
      await this.s3Client.send(command);
      return true;
    } catch {
      return false;
    }
  }

  async getSignedUrl(key: string, expiresIn: number = 3600): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });
    return getSignedUrl(this.s3Client, command, { expiresIn });
  }

  async getPublicUrl(key: string): Promise<string> {
    if (this.cdnUrl) {
      return `${this.cdnUrl}/${key}`;
    }
    return this.getSignedUrl(key);
  }

  async listKeys(prefix: string): Promise<string[]> {
    try {
      const command = new ListObjectsV2Command({
        Bucket: this.bucket,
        Prefix: prefix,
      });
      const result = await this.s3Client.send(command);
      return (result.Contents || []).map((obj) => obj.Key || '').filter(Boolean);
    } catch (error) {
      this.logger.error(`Failed to list keys with prefix ${prefix}:`, error);
      return [];
    }
  }

  private async streamToBuffer(stream: Readable): Promise<Buffer> {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }
}
