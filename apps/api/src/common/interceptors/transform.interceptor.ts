import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  meta?: {
    timestamp: string;
    [key: string]: any;
  };
}

@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<T, ApiResponse<T>> {
  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<ApiResponse<T>> {
    return next.handle().pipe(
      map((data) => {
        const response = context.switchToHttp().getResponse();
        const meta: any = { timestamp: new Date().toISOString() };

        if (data?.pagination) {
          meta.pagination = data.pagination;
          delete data.pagination;
        }

        if (data?.message) {
          meta.message = data.message;
          delete data.message;
        }

        return {
          success: true,
          data,
          meta,
        };
      }),
    );
  }
}
