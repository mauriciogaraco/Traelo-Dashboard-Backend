import type { Request, Response } from 'express';
import { sendCreated, sendNoContent, sendOk } from '../../shared/http';
import * as customerAuthService from './customer-auth.service';
import type {
  ForgotPasswordCustomerInput,
  LoginCustomerInput,
  RefreshCustomerInput,
  RegisterCustomerInput,
  ResetPasswordCustomerInput,
} from './customer-auth.dto';

function requestContext(req: Request): customerAuthService.RequestContext {
  return { userAgent: req.headers['user-agent'], ipAddress: req.ip };
}

export async function register(req: Request, res: Response): Promise<void> {
  const session = await customerAuthService.register(
    req.body as RegisterCustomerInput,
    requestContext(req),
  );
  sendCreated(res, session);
}

export async function login(req: Request, res: Response): Promise<void> {
  const session = await customerAuthService.login(
    req.body as LoginCustomerInput,
    requestContext(req),
  );
  sendOk(res, session);
}

export async function refresh(req: Request, res: Response): Promise<void> {
  const { refreshToken } = req.body as RefreshCustomerInput;
  const result = await customerAuthService.refresh(refreshToken, requestContext(req));
  sendOk(res, result);
}

export async function logout(req: Request, res: Response): Promise<void> {
  const { refreshToken } = req.body as RefreshCustomerInput;
  await customerAuthService.logout(refreshToken);
  sendNoContent(res);
}

export async function forgotPassword(req: Request, res: Response): Promise<void> {
  const result = await customerAuthService.forgotPassword(req.body as ForgotPasswordCustomerInput);
  sendOk(res, result);
}

export async function resetPassword(req: Request, res: Response): Promise<void> {
  await customerAuthService.resetPassword(req.body as ResetPasswordCustomerInput);
  sendNoContent(res);
}
