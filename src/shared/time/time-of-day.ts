// TIME (sin zona horaria) se representa en Prisma con un Date anclado a 1970-01-01; se lee y
// escribe siempre en UTC para que el resultado no dependa del TZ del proceso de Node (mismo
// espíritu que el anclaje a mediodía UTC usado para fechas en settlements.dto.ts).
export function timeToString(date: Date): string {
  return `${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')}`;
}

export function timeStringToDate(value: string): Date {
  const [hours, minutes] = value.split(':').map(Number);
  return new Date(Date.UTC(1970, 0, 1, hours, minutes, 0));
}
