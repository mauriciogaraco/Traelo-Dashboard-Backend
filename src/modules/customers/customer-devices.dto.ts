import { z } from 'zod';
import { DevicePlatform } from '../../generated/prisma/enums';

export const deviceParamsSchema = z.object({
  id: z.cuid('id de cliente inválido'),
  deviceId: z.cuid('id de dispositivo inválido'),
});

export type DeviceParams = z.infer<typeof deviceParamsSchema>;

export const registerDeviceSchema = z.object({
  platform: z.enum(DevicePlatform),
  pushToken: z.string().min(1).max(300).optional(),
  appVersion: z.string().min(1).max(30).optional(),
});

export type RegisterDeviceInput = z.infer<typeof registerDeviceSchema>;

export const updateDeviceSchema = z.object({
  pushToken: z.string().min(1).max(300).optional(),
  appVersion: z.string().min(1).max(30).optional(),
  active: z.boolean().optional(),
});

export type UpdateDeviceInput = z.infer<typeof updateDeviceSchema>;
