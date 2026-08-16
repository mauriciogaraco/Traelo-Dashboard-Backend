import type { Request, Response } from 'express';
import { sendOk } from '../shared/http';
import * as systemConfigService from './system-config.service';
import type { UpdateSystemConfigInput } from './system-config.dto';

export async function getConfig(_req: Request, res: Response): Promise<void> {
  const config = await systemConfigService.getSystemConfig();
  sendOk(res, config);
}

export async function updateConfig(req: Request, res: Response): Promise<void> {
  const input = req.body as UpdateSystemConfigInput;
  const config = await systemConfigService.updateSystemConfig(input);
  sendOk(res, config);
}
