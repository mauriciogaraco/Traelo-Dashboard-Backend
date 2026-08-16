import type { NextFunction, Request, Response } from 'express';
import type { ZodType } from 'zod';

interface ValidationSchemas {
  body?: ZodType;
  query?: ZodType;
  params?: ZodType;
}

export function validate(schemas: ValidationSchemas) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (schemas.body) {
      req.body = schemas.body.parse(req.body);
    }
    if (schemas.query) {
      // req.query is a non-cached getter in Express 5 (recomputed from the URL on every
      // access), so mutating the object it returns has no effect on later reads. Replacing
      // the property descriptor on this request instance is the only way to make the
      // validated/defaulted query stick for the rest of the request.
      Object.defineProperty(req, 'query', {
        value: schemas.query.parse(req.query),
        writable: true,
        enumerable: true,
        configurable: true,
      });
    }
    if (schemas.params) {
      Object.assign(req.params, schemas.params.parse(req.params));
    }
    next();
  };
}
