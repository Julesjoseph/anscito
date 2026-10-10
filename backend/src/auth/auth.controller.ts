import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { AuthService } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  @HttpCode(200)
  login(@Body() body: { username?: string; password?: string }) {
    return this.auth.login(body?.username ?? '', body?.password ?? '');
  }
}