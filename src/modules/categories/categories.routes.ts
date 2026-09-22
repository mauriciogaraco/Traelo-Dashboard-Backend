import { Router } from 'express';
import { authenticate } from '../../middlewares/authenticate';
import { authorize } from '../../middlewares/authorize';
import { validate } from '../../middlewares/validate';
import { imageUpload } from '../../middlewares/imageUpload';
import { Role } from '../../generated/prisma/enums';
import * as categoriesController from './categories.controller';
import {
  categoryIdParamSchema,
  createCategorySchema,
  listCategoriesQuerySchema,
  updateCategorySchema,
} from './categories.dto';

export const categoriesRouter = Router();

categoriesRouter.use(authenticate);

categoriesRouter.get(
  '/',
  // El dueño de negocio solo la necesita para elegir categoría al editar sus productos.
  authorize(Role.OWNER, Role.ADMIN, Role.EMPLOYEE, Role.BUSINESS_OWNER),
  validate({ query: listCategoriesQuerySchema }),
  categoriesController.listCategories,
);

categoriesRouter.post(
  '/',
  authorize(Role.OWNER, Role.ADMIN),
  validate({ body: createCategorySchema }),
  categoriesController.createCategory,
);

categoriesRouter.get(
  '/:id',
  authorize(Role.OWNER, Role.ADMIN, Role.EMPLOYEE),
  validate({ params: categoryIdParamSchema }),
  categoriesController.getCategory,
);

categoriesRouter.patch(
  '/:id',
  authorize(Role.OWNER, Role.ADMIN),
  validate({ params: categoryIdParamSchema, body: updateCategorySchema }),
  categoriesController.updateCategory,
);

categoriesRouter.delete(
  '/:id',
  authorize(Role.OWNER, Role.ADMIN),
  validate({ params: categoryIdParamSchema }),
  categoriesController.deactivateCategory,
);

categoriesRouter.post(
  '/:id/image',
  authorize(Role.OWNER, Role.ADMIN),
  validate({ params: categoryIdParamSchema }),
  imageUpload.single('image'),
  categoriesController.setImage,
);
