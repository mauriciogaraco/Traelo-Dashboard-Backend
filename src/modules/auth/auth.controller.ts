import type { Request, Response } from 'express';
import { sendOk, sendCreated, sendNoContent } from '../../shared/http';
import { UnauthorizedError } from '../../shared/errors';
import * as authService from './auth.service';
import type {
  ChangePasswordInput,
  ForgotPasswordInput,
  LoginInput,
  LogoutInput,
  RefreshInput,
  RegisterInput,
  ResetPasswordInput,
} from './auth.dto';

function requestContext(req: Request) {
  return { userAgent: req.headers['user-agent'], ipAddress: req.ip };
}

export async function register(req: Request, res: Response): Promise<void> {
  const result = await authService.register(req.body as RegisterInput, requestContext(req));
  sendCreated(res, result);
}

export async function login(req: Request, res: Response): Promise<void> {
  const result = await authService.login(req.body as LoginInput, requestContext(req));
  sendOk(res, result);
}

export async function refresh(req: Request, res: Response): Promise<void> {
  const { refreshToken } = req.body as RefreshInput;
  const result = await authService.refresh(refreshToken, requestContext(req));
  sendOk(res, result);
}

export async function logout(req: Request, res: Response): Promise<void> {
  const { refreshToken } = req.body as LogoutInput;
  await authService.logout(refreshToken);
  sendNoContent(res);
}

export async function forgotPassword(req: Request, res: Response): Promise<void> {
  await authService.forgotPassword(req.body as ForgotPasswordInput);
  sendOk(res, { message: 'Si el correo existe, se enviarán instrucciones de recuperación.' });
}

export async function resetPassword(req: Request, res: Response): Promise<void> {
  await authService.resetPassword(req.body as ResetPasswordInput);
  sendNoContent(res);
}

export async function changePassword(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    throw new UnauthorizedError();
  }
  await authService.changePassword(req.user.sub, req.body as ChangePasswordInput);
  sendNoContent(res);
}
