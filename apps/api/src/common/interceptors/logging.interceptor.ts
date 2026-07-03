import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { Request } from 'express';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('HTTP');

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest<Request>();
    const { method, url, ip } = request;
    const userAgent = request.headers['user-agent'] || '';
    const startTime = Date.now();

    return next.handle().pipe(
      tap({
        next: () => {
          const responseTime = Date.now() - startTime;
          const statusCode = context.switchToHttp().getResponse().statusCode;

          this.logger.log(
            `${method} ${url} ${statusCode} ${responseTime}ms - ${ip} - ${userAgent.substring(0, 50)}`,
          );
        },
        error: (error) => {
          const responseTime = Date.now() - startTime;
          this.logger.error(
            `${method} ${url} ${error.status || 500} ${responseTime}ms - ${ip} - ${error.message}`,
          );
        },
      }),
    );
  }
}
