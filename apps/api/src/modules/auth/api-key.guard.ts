import {
  Injectable,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class ApiKeyGuard extends AuthGuard('api-key') {
  handleRequest(err: Error | null, user: any, info: any) {
    if (err || !user) {
      throw err || new UnauthorizedException('Invalid or missing API key');
    }
    return user;
  }
}
