import { Router } from 'express';
import { authenticate } from '../../middlewares/authenticate';
import { authorize } from '../../middlewares/authorize';
import { validate } from '../../middlewares/validate';
import { idParamSchema } from '../../shared/http';
import { Role } from '../../generated/prisma/enums';
import * as usersController from './users.controller';
import { listUsersQuerySchema, updateUserSchema } from './users.dto';

export const usersRouter = Router();

usersRouter.use(authenticate, authorize(Role.OWNER, Role.ADMIN));

usersRouter.get('/', validate({ query: listUsersQuerySchema }), usersController.listUsers);

usersRouter.get('/:id', validate({ params: idParamSchema }), usersController.getUser);

usersRouter.patch(
  '/:id',
  validate({ params: idParamSchema, body: updateUserSchema }),
  usersController.updateUser,
);

usersRouter.delete('/:id', validate({ params: idParamSchema }), usersController.deactivateUser);
