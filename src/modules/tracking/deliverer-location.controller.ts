import type { Request, Response } from 'express';
import { sendOk } from '../../shared/http';
import { UnauthorizedError } from '../../shared/errors';
import * as delivererLocationService from './deliverer-location.service';
import type { UpdateDelivererLocationInput } from './deliverer-location.dto';

export async function updateMyLocation(req: Request, res: Response): Promise<void> {
  if (!req.user) {
    throw new UnauthorizedError();
  }
  const location = await delivererLocationService.updateMyLocation(
    req.user.sub,
    req.body as UpdateDelivererLocationInput,
  );
  sendOk(res, location);
}
