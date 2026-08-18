import type { Request, Response } from 'express';
import { sendOk, sendPaginated, type IdParam } from '../../shared/http';
import * as usersService from './users.service';
import type { ListUsersQuery, ResetPasswordInput, UpdateUserInput } from './users.dto';

export async function listUsers(req: Request, res: Response): Promise<void> {
  const query = req.query as unknown as ListUsersQuery;
  const { data, meta } = await usersService.listUsers(query);
  sendPaginated(res, data, meta);
}

export async function getUser(req: Request, res: Response): Promise<void> {
  const { id } = req.params as unknown as IdParam;
  const user = await usersService.getUserById(id);
  sendOk(res, user);
}

export async function updateUser(req: Request, res: Response): Promise<void> {
  const { id } = req.params as unknown as IdParam;
  const input = req.body as UpdateUserInput;
  const user = await usersService.updateUser(id, input);
  sendOk(res, user);
}

export async function deactivateUser(req: Request, res: Response): Promise<void> {
  const { id } = req.params as unknown as IdParam;
  const user = await usersService.deactivateUser(id);
  sendOk(res, user);
}

export async function resetPassword(req: Request, res: Response): Promise<void> {
  const { id } = req.params as unknown as IdParam;
  const { password } = req.body as ResetPasswordInput;
  const user = await usersService.resetPassword(id, password);
  sendOk(res, user);
}
