import type { Request, Response } from 'express';
import { sendCreated, sendOk, sendPaginated } from '../../shared/http';
import { BadRequestError } from '../../shared/errors';
import * as categoriesService from './categories.service';
import type {
  CategoryIdParam,
  CreateCategoryInput,
  ListCategoriesQuery,
  UpdateCategoryInput,
} from './categories.dto';

export async function listCategories(req: Request, res: Response): Promise<void> {
  const query = req.query as unknown as ListCategoriesQuery;
  const { data, meta } = await categoriesService.listCategories(query);
  sendPaginated(res, data, meta);
}

export async function createCategory(req: Request, res: Response): Promise<void> {
  const category = await categoriesService.createCategory(req.body as CreateCategoryInput);
  sendCreated(res, category);
}

export async function getCategory(req: Request, res: Response): Promise<void> {
  const { id } = req.params as unknown as CategoryIdParam;
  const category = await categoriesService.getCategory(id);
  sendOk(res, category);
}

export async function updateCategory(req: Request, res: Response): Promise<void> {
  const { id } = req.params as unknown as CategoryIdParam;
  const category = await categoriesService.updateCategory(id, req.body as UpdateCategoryInput);
  sendOk(res, category);
}

export async function deactivateCategory(req: Request, res: Response): Promise<void> {
  const { id } = req.params as unknown as CategoryIdParam;
  const category = await categoriesService.deactivateCategory(id);
  sendOk(res, category);
}

export async function setImage(req: Request, res: Response): Promise<void> {
  const { id } = req.params as unknown as CategoryIdParam;
  if (!req.file) {
    throw new BadRequestError('Falta el archivo de imagen (campo "image")', 'MISSING_FILE');
  }
  const category = await categoriesService.setCategoryImage(id, req.file.buffer);
  sendOk(res, category);
}
