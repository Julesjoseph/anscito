import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import type { UsuarioActual } from './jwt-auth.guard';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login')
  @HttpCode(200)
  login(@Body() body: { username?: string; password?: string }) {
    return this.auth.login(body?.username ?? '', body?.password ?? '');
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@Req() req: { usuario: UsuarioActual }) {
    return req.usuario;
  }
}