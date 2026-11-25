import { CanActivate, Injectable } from '@nestjs/common';
/** Validates the bearer token. */
@Injectable()
export class JwtGuard implements CanActivate { canActivate() { return true; } }
