import { Router } from 'express';
import { authenticate } from '../../middlewares/authenticate';
import { authorize } from '../../middlewares/authorize';
import { validate } from '../../middlewares/validate';
import { Role } from '../../generated/prisma/enums';
import * as authController from './auth.controller';
import {
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  logoutSchema,
  refreshSchema,
  registerSchema,
  resetPasswordSchema,
} from './auth.dto';

export const authRouter = Router();

authRouter.post(
  '/register',
  authenticate,
  authorize(Role.OWNER, Role.ADMIN),
  validate({ body: registerSchema }),
  authController.register,
);

authRouter.post('/login', validate({ body: loginSchema }), authController.login);

authRouter.post('/refresh', validate({ body: refreshSchema }), authController.refresh);

authRouter.post('/logout', validate({ body: logoutSchema }), authController.logout);

authRouter.post(
  '/forgot-password',
  validate({ body: forgotPasswordSchema }),
  authController.forgotPassword,
);

authRouter.post(
  '/reset-password',
  validate({ body: resetPasswordSchema }),
  authController.resetPassword,
);

authRouter.post(
  '/change-password',
  authenticate,
  validate({ body: changePasswordSchema }),
  authController.changePassword,
);
