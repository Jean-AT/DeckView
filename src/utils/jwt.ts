import jwt, { type SignOptions } from 'jsonwebtoken';
import { env } from '../config/env';

export type TokenKind = 'access' | 'refresh';

interface TokenPayload {
  sub: string;
  role: string;
  kind: TokenKind;
}

export function signToken(payload: TokenPayload): string {
  const secret = payload.kind === 'refresh' ? env.JWT_REFRESH_SECRET : env.JWT_SECRET;
  const expiresIn = payload.kind === 'refresh' ? env.JWT_REFRESH_EXPIRES_IN : env.JWT_EXPIRES_IN;

  return jwt.sign(payload, secret, { expiresIn } as SignOptions);
}

export function verifyToken(token: string, kind: TokenKind): TokenPayload {
  const secret = kind === 'refresh' ? env.JWT_REFRESH_SECRET : env.JWT_SECRET;
  const decoded = jwt.verify(token, secret) as jwt.JwtPayload;

  if (decoded.kind !== kind) {
    throw new jwt.JsonWebTokenError('Wrong token kind');
  }

  if (typeof decoded.sub !== 'string' || typeof decoded.role !== 'string') {
    throw new jwt.JsonWebTokenError('Invalid token payload');
  }

  return {
    sub: decoded.sub,
    role: decoded.role,
    kind: decoded.kind,
  };
}
