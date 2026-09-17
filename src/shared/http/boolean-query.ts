import { z } from 'zod';

// z.coerce.boolean() en un filtro de query string es un bug conocido en este proyecto
// (ver active en businesses/products/users/deliverers): Boolean("false") es true en JS, así
// que ?active=false termina filtrando como si fuera true. Este helper compara el string
// literal en vez de castear, para que los módulos nuevos no repitan ese error.
export const booleanQueryParam = z.enum(['true', 'false']).transform((value) => value === 'true');
