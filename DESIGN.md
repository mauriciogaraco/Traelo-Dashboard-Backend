# Tráelo Operaciones — Backend interno

Diseño de dominio y arquitectura, previo a la implementación. Documento vivo: se actualiza si el modelo cambia durante el desarrollo.

## 1. Análisis del dominio

Tráelo Operaciones **no** es la app que usan los clientes finales (esa es la PWA/app móvil, independiente). Es el backend que usa el personal interno de Tráelo para coordinar la operación logística diaria:

- Registrar pedidos que llegan por teléfono/WhatsApp/PWA y coordinarlos manualmente.
- Asignar mensajeros.
- Llevar la cuenta de cuánto gana Tráelo, cuánto gana cada mensajero, y cuánto le corresponde a cada negocio.
- Cerrar cuadres de caja (diarios y semanales) con cada mensajero.
- Dar visibilidad (dashboard/reportes) del negocio a los dueños/administradores.

Dos fuentes de ingreso de Tráelo por pedido:

1. **Comisión del negocio** — por cada venta que un negocio hace a través de Tráelo, se calcula con uno de dos modelos configurables por negocio: `PERCENTAGE` (% sobre el subtotal vendido) o `FIXED_PER_PRODUCT` (monto fijo en CUP por producto vendido, con posibilidad de override por producto específico).
2. **Costo de mensajería** — lo paga el cliente final, y se reparte entre Tráelo y el mensajero según un porcentaje configurable (por defecto 60% mensajero / 40% Tráelo, pero ajustable por mensajero individual).

Un pedido puede involucrar **varios negocios a la vez** (el cliente pide de dos negocios distintos y se entrega junto), lo cual es la decisión de modelado más importante de todo el sistema: un `Order` no pertenece a un solo `Business`.

Los "clientes finales" **no son usuarios** de este backend — son solo datos de contacto dentro del pedido (nombre, teléfono, dirección). No hay tabla `Customer` con cuenta/login.

## 2. Roles y permisos (RBAC)

4 roles fijos, sin necesidad de una tabla de permisos dinámica (sería sobre-ingeniería para 4 roles estables). RBAC por middleware con enum `Role`.

| Módulo | OWNER | ADMIN | EMPLOYEE | DELIVERER |
|---|---|---|---|---|
| Usuarios (staff) | CRUD | CRUD (no OWNER) | — | — |
| Config del sistema | RW | R | — | — |
| Negocios / catálogo / comisiones | CRUD | CRUD | R | — |
| Mensajeros | CRUD | CRUD | R | perfil propio (R) |
| Pedidos | CRUD | CRUD | Crear/asignar/actualizar | R (solo asignados a él) |
| Cuadres | CRUD + cerrar | CRUD + cerrar | Generar (OPEN) | R (solo propios) |
| Reportes / Dashboard | Todo | Todo | Limitado (operativo) | — |

## 3. Decisiones de modelado clave

- **Deliverer no duplica User.** `Deliverer` es una extensión 1:1 de `User` (mismo patrón que "perfil"): el nombre, teléfono, rol y estado activo viven en `User`; `Deliverer` solo agrega lo que es específico del oficio (fecha de ingreso, % de comisión propio).
- **Pedido multi-negocio vía tabla intermedia.** `Order` → `OrderBusiness` (1 por negocio involucrado) → `OrderItem` (líneas de producto de ese negocio en ese pedido). Así un pedido soporta N negocios sin romper normalización, y cada `OrderBusiness` carga su propia comisión ganada.
- **Snapshot de precios y comisiones en `OrderItem`/`OrderBusiness`.** El nombre del producto, precio unitario y comisión se copian al momento de la venta. Si luego cambia el catálogo o el % de comisión del negocio, los pedidos históricos no se alteran. Esto es crítico para que los cuadres y reportes pasados sigan siendo exactos.
- **Catálogo de productos opcional, no bloqueante** (tu respuesta). `Product` pertenece a un `Business`, pero `OrderItem.productId` es nullable — si el producto no está cargado, el empleado escribe el nombre y precio libremente en `OrderItem.productName`/`unitPrice`. `Product.externalId` queda listo para importar desde el `catalog.json` de la PWA en el futuro, sin obligarlo ahora.
- **`BusinessProductCommission` como entidad separada** (tal como pediste), en vez de un campo suelto en `Product`, para dejar claro que es configuración financiera, no parte del catálogo/presentación.
- **Cuadres (`Settlement`) persistidos y cerrables** (tu respuesta). Mientras `status = OPEN`, se puede regenerar/recalcular (por si se reasignan pedidos, se corrige un mensajero, etc.). Al pasar a `CLOSED`, queda inmutable — es la foto financiera final que se entregó al mensajero.
- **Sin historial de estados de pedido** (tu respuesta), pero sí agrego 3 timestamps puntuales (`assignedAt`, `completedAt`, `cancelledAt`) directamente en `Order`. No es una auditoría de "quién cambió qué" — es solo la fecha en la que pasó cada cosa, necesaria para que los reportes por rango de fechas (hoy/semana/mes/etc.) filtren por fecha de **completado**, no de creación. Lo marco como propuesta explícita porque roza tu "no" — dime si prefieres quitarlo y quedarte solo con `orderDate`.
- **`BusinessSubscription` para el plan (7/15/21/30 días)** (tu respuesta). El plan no es una etiqueta fija en `Business`; es un ciclo de suscripción con `startDate`/`endDate`/`price`/`status`, que permite ver vencimientos y renovaciones. El "plan actual" del negocio se deriva de la suscripción `ACTIVE` más reciente (no se duplica en `Business`).
- **Dinero siempre como `Decimal`**, nunca `Float` — evita errores de redondeo en comisiones y cuadres.
- **`SystemConfig` como tabla singleton** — guarda el % de comisión por defecto del mensajero (60%) y cualquier otro parámetro global configurable, sin necesitar redeploy para cambiarlo.

## 4. Entidades y relaciones

```
User 1───1 Deliverer
User 1───N RefreshToken
User 1───N PasswordResetToken
User 1───N Order            (registeredBy)
User 1───N Settlement       (closedBy)

Business 1───N Product
Business 1───N BusinessProductCommission
Business 1───N BusinessSubscription
Business 1───N OrderBusiness

Product 1───1 BusinessProductCommission (opcional)
Product 1───N OrderItem

Order 1───N OrderBusiness
Order N───1 Deliverer (opcional, hasta que se asigna)
OrderBusiness 1───N OrderItem

Deliverer 1───N Order
Deliverer 1───N Settlement

Settlement 1───N SettlementOrderLine ───N1 Order
```

## 5. Arquitectura modular (carpetas)

Siguiendo tu lista de módulos. `products`, `commissions` y `subscriptions` van anidados dentro de `businesses` (son sub-recursos de un negocio, no ameritan ser top-level).

```
src/
  config/                # env.ts (variables de entorno) + system-config (parámetros globales configurables)
    env.ts
    system-config.routes.ts
    system-config.controller.ts
    system-config.service.ts
    system-config.dto.ts

  shared/                # kernel compartido, sin lógica de negocio
    errors/               # AppError, NotFoundError, ValidationError, ConflictError, ForbiddenError
    http/                 # asyncHandler, ApiResponse, pagination helpers
    prisma/               # PrismaClient singleton
    logger/               # pino logger
    date-range/           # resuelve "today|week|month|6months|year|custom" -> {from, to}

  middlewares/
    authenticate.ts        # valida JWT
    authorize.ts            # requireRole([...])
    validate.ts              # valida body/query/params con Zod
    errorHandler.ts          # manejo centralizado de errores

  modules/
    auth/
      auth.routes.ts
      auth.controller.ts
      auth.service.ts
      auth.dto.ts
      token.service.ts        # firma/verifica access + refresh tokens

    users/
      users.routes.ts
      users.controller.ts
      users.service.ts
      users.dto.ts

    businesses/
      businesses.routes.ts
      businesses.controller.ts
      businesses.service.ts
      businesses.repository.ts    # queries compuestas (comisiones, filtros)
      businesses.dto.ts
      products.routes.ts
      products.controller.ts
      products.service.ts
      subscriptions.routes.ts
      subscriptions.controller.ts
      subscriptions.service.ts

    deliverers/
      deliverers.routes.ts
      deliverers.controller.ts
      deliverers.service.ts
      deliverers.dto.ts

    orders/
      orders.routes.ts
      orders.controller.ts
      orders.service.ts           # cálculo de comisiones/ganancias en transacción
      orders.repository.ts        # queries con joins de OrderBusiness/OrderItem
      orders.dto.ts

    settlements/
      settlements.routes.ts
      settlements.controller.ts
      settlements.service.ts      # genera/recalcula OPEN, cierra CLOSED
      settlements.repository.ts
      settlements.dto.ts

    reports/
      reports.routes.ts
      reports.controller.ts
      reports.service.ts
      reports.repository.ts       # agregaciones SQL/Prisma pesadas

    dashboard/
      dashboard.routes.ts
      dashboard.controller.ts
      dashboard.service.ts

  app.ts                   # Express app, monta middlewares y rutas
  server.ts                 # bootstrap (listen, graceful shutdown)

prisma/
  schema.prisma
  seed.ts
```

Repository Pattern se usa donde hay consultas compuestas o agregaciones (orders, settlements, reports, businesses); en módulos de CRUD simple (users, deliverers) el service llama a Prisma directamente — evita una capa de indirección sin valor.

## 6. Prisma Schema (propuesto)

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// ── Enums ────────────────────────────────────────────────

enum Role {
  OWNER
  ADMIN
  EMPLOYEE
  DELIVERER
}

enum CommissionType {
  PERCENTAGE
  FIXED_PER_PRODUCT
}

enum SubscriptionCycle {
  DAYS_7
  DAYS_15
  DAYS_21
  DAYS_30
}

enum SubscriptionStatus {
  ACTIVE
  EXPIRED
  CANCELLED
}

enum OrderStatus {
  PENDING
  ASSIGNED
  COMPLETED
  CANCELLED
}

enum SettlementType {
  DAILY
  WEEKLY
}

enum SettlementStatus {
  OPEN
  CLOSED
}

// ── Auth / Usuarios ──────────────────────────────────────

model User {
  id           String   @id @default(cuid())
  name         String
  email        String   @unique
  passwordHash String
  phone        String?
  role         Role
  active       Boolean  @default(true)
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  deliverer          Deliverer?
  refreshTokens      RefreshToken[]
  passwordResets     PasswordResetToken[]
  registeredOrders   Order[]      @relation("OrderRegisteredBy")
  closedSettlements  Settlement[] @relation("SettlementClosedBy")

  @@index([role])
  @@map("users")
}

model RefreshToken {
  id                  String    @id @default(cuid())
  userId              String
  user                User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  tokenHash           String    @unique
  expiresAt           DateTime
  revokedAt           DateTime?
  replacedByTokenHash String?
  userAgent           String?
  ipAddress           String?
  createdAt           DateTime  @default(now())

  @@index([userId])
  @@map("refresh_tokens")
}

model PasswordResetToken {
  id        String    @id @default(cuid())
  userId    String
  user      User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  tokenHash String    @unique
  expiresAt DateTime
  usedAt    DateTime?
  createdAt DateTime  @default(now())

  @@index([userId])
  @@map("password_reset_tokens")
}

// ── Mensajeros ───────────────────────────────────────────

model Deliverer {
  id                   String   @id @default(cuid())
  userId               String   @unique
  user                 User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  joinedAt             DateTime @default(now())
  commissionPercentage Decimal? @db.Decimal(5, 2) // null => usa SystemConfig.defaultDelivererCommissionPercentage
  createdAt            DateTime @default(now())
  updatedAt            DateTime @updatedAt

  assignedOrders Order[]      @relation("OrderDeliverer")
  settlements    Settlement[]

  @@map("deliverers")
}

// ── Negocios / Catálogo ──────────────────────────────────

model Business {
  id                              String         @id @default(cuid())
  name                            String
  phone                           String
  address                         String
  joinedAt                        DateTime       @default(now())
  active                          Boolean        @default(true)
  commissionType                  CommissionType
  commissionPercentage            Decimal?       @db.Decimal(5, 2)  // usado si commissionType = PERCENTAGE
  defaultProductCommissionAmount  Decimal?       @db.Decimal(10, 2) // fallback si commissionType = FIXED_PER_PRODUCT y el producto no tiene comisión propia
  createdAt                       DateTime       @default(now())
  updatedAt                       DateTime       @updatedAt

  products            Product[]
  productCommissions  BusinessProductCommission[]
  subscriptions        BusinessSubscription[]
  orderBusinesses      OrderBusiness[]

  @@index([active])
  @@map("businesses")
}

model BusinessSubscription {
  id         String              @id @default(cuid())
  businessId String
  business   Business            @relation(fields: [businessId], references: [id], onDelete: Cascade)
  cycle      SubscriptionCycle
  price      Decimal             @db.Decimal(10, 2)
  startDate  DateTime
  endDate    DateTime
  status     SubscriptionStatus  @default(ACTIVE)
  createdAt  DateTime            @default(now())

  @@index([businessId, status])
  @@map("business_subscriptions")
}

model Product {
  id         String   @id @default(cuid())
  businessId String
  business   Business @relation(fields: [businessId], references: [id], onDelete: Cascade)
  name       String
  category   String?
  price      Decimal? @db.Decimal(10, 2) // precio referencial, informativo (no autoritativo del pedido)
  active     Boolean  @default(true)
  externalId String?  // id del catálogo público de la PWA, para futura sincronización
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt

  commission BusinessProductCommission?
  orderItems OrderItem[]

  @@unique([businessId, externalId])
  @@index([businessId, active])
  @@map("products")
}

model BusinessProductCommission {
  id               String   @id @default(cuid())
  businessId       String
  business         Business @relation(fields: [businessId], references: [id], onDelete: Cascade)
  productId        String   @unique
  product          Product  @relation(fields: [productId], references: [id], onDelete: Cascade)
  commissionAmount Decimal  @db.Decimal(10, 2)
  createdAt        DateTime @default(now())
  updatedAt        DateTime @updatedAt

  @@map("business_product_commissions")
}

// ── Pedidos ──────────────────────────────────────────────

model Order {
  id               String      @id @default(cuid())
  orderNumber      Int         @unique @default(autoincrement())
  customerName     String
  customerAddress  String
  addressReference String?
  customerPhone    String
  deliveryFee      Decimal     @db.Decimal(10, 2)
  status           OrderStatus @default(PENDING)
  orderDate        DateTime    @default(now())
  assignedAt       DateTime?
  completedAt      DateTime?
  cancelledAt      DateTime?

  delivererId String?
  deliverer   Deliverer? @relation("OrderDeliverer", fields: [delivererId], references: [id])

  registeredByUserId String
  registeredBy       User   @relation("OrderRegisteredBy", fields: [registeredByUserId], references: [id])

  productsTotal    Decimal @db.Decimal(10, 2) // suma de OrderBusiness.subtotal
  total            Decimal @db.Decimal(10, 2) // productsTotal + deliveryFee
  traeloEarning    Decimal @db.Decimal(10, 2) // comisiones de negocios + parte de Tráelo en mensajería
  delivererEarning Decimal @db.Decimal(10, 2) // parte del mensajero en mensajería

  businesses      OrderBusiness[]
  settlementLines SettlementOrderLine[]

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@index([status])
  @@index([orderDate])
  @@index([delivererId])
  @@map("orders")
}

model OrderBusiness {
  id               String   @id @default(cuid())
  orderId          String
  order            Order    @relation(fields: [orderId], references: [id], onDelete: Cascade)
  businessId       String
  business         Business @relation(fields: [businessId], references: [id])
  subtotal         Decimal  @db.Decimal(10, 2) // suma de sus OrderItem
  commissionEarned Decimal  @db.Decimal(10, 2) // ganancia de Tráelo por este negocio en este pedido

  items OrderItem[]

  @@unique([orderId, businessId])
  @@index([businessId])
  @@map("order_businesses")
}

model OrderItem {
  id               String        @id @default(cuid())
  orderBusinessId  String
  orderBusiness    OrderBusiness @relation(fields: [orderBusinessId], references: [id], onDelete: Cascade)
  productId        String?
  product          Product?      @relation(fields: [productId], references: [id])
  productName      String        // snapshot: nombre al momento de la venta
  quantity         Int           @default(1)
  unitPrice        Decimal       @db.Decimal(10, 2)
  subtotal         Decimal       @db.Decimal(10, 2)
  commissionAmount Decimal       @db.Decimal(10, 2) // solo relevante si el negocio es FIXED_PER_PRODUCT

  @@index([productId])
  @@map("order_items")
}

// ── Cuadres ──────────────────────────────────────────────

model Settlement {
  id          String            @id @default(cuid())
  type        SettlementType
  delivererId String
  deliverer   Deliverer         @relation(fields: [delivererId], references: [id])
  periodStart DateTime
  periodEnd   DateTime
  status      SettlementStatus  @default(OPEN)

  totalDeliveries    Int     @default(0)
  totalCollected     Decimal @db.Decimal(10, 2) @default(0) // dinero total cobrado en mensajería
  traeloShare        Decimal @db.Decimal(10, 2) @default(0)
  delivererShare     Decimal @db.Decimal(10, 2) @default(0)
  productCommissions Decimal @db.Decimal(10, 2) @default(0) // intereses por productos
  totalToDeliver     Decimal @db.Decimal(10, 2) @default(0) // lo que el mensajero debe entregar

  closedAt       DateTime?
  closedByUserId String?
  closedBy       User?     @relation("SettlementClosedBy", fields: [closedByUserId], references: [id])

  orderLines SettlementOrderLine[]

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  @@unique([delivererId, type, periodStart, periodEnd])
  @@index([status])
  @@map("settlements")
}

model SettlementOrderLine {
  id           String     @id @default(cuid())
  settlementId String
  settlement   Settlement @relation(fields: [settlementId], references: [id], onDelete: Cascade)
  orderId      String
  order        Order      @relation(fields: [orderId], references: [id])

  @@unique([settlementId, orderId])
  @@map("settlement_order_lines")
}

// ── Config global ────────────────────────────────────────

model SystemConfig {
  id                                    String   @id @default("singleton")
  defaultDelivererCommissionPercentage  Decimal  @db.Decimal(5, 2) @default(60)
  updatedAt                             DateTime @updatedAt

  @@map("system_config")
}
```

## 7. Reglas de negocio a implementar en el service layer (no en el schema)

- Las ganancias (`traeloEarning`, `delivererEarning`, `commissionEarned`) se calculan y persisten dentro de una transacción Prisma al crear el pedido, usando el % o comisión vigente **en ese momento** — de ahí el snapshot.
- Si `Business.commissionType = PERCENTAGE`: comisión se calcula a nivel de `OrderBusiness` (`subtotal * commissionPercentage / 100`); no hace falta desglosar por línea.
- Si `Business.commissionType = FIXED_PER_PRODUCT`: comisión se calcula por línea en `OrderItem` (usa `BusinessProductCommission` si existe para ese producto, si no `Business.defaultProductCommissionAmount`), y `OrderBusiness.commissionEarned` es la suma de sus líneas.
- Reparto de mensajería: `delivererEarning = deliveryFee * (deliverer.commissionPercentage ?? SystemConfig.default) / 100`; `traeloEarning += deliveryFee - delivererEarning`.
- Un pedido solo aporta a un cuadre cuando `status = COMPLETED` y tiene `delivererId`.
- Generar cuadre (`OPEN`): recolecta pedidos completados del mensajero en el rango de fechas que no estén ya en un cuadre `CLOSED`, y recalcula totales — se puede volver a llamar mientras esté `OPEN`.
- Cerrar cuadre (`CLOSED`): fija `closedAt`/`closedByUserId`, y a partir de ahí el service rechaza cualquier intento de regenerarlo.
- Un `DELIVERER` autenticado solo puede leer sus propios pedidos/cuadres (ownership check en el service, no solo el rol).

## 8. Endpoints propuestos (REST, sin exceso)

```
POST   /api/v1/auth/login
POST   /api/v1/auth/register            (OWNER/ADMIN)
POST   /api/v1/auth/refresh
POST   /api/v1/auth/logout
POST   /api/v1/auth/forgot-password
POST   /api/v1/auth/reset-password
POST   /api/v1/auth/change-password     (autenticado)

GET    /api/v1/users
GET    /api/v1/users/:id
PATCH  /api/v1/users/:id
DELETE /api/v1/users/:id                (soft delete)

GET    /api/v1/businesses
POST   /api/v1/businesses
GET    /api/v1/businesses/:id
PATCH  /api/v1/businesses/:id
DELETE /api/v1/businesses/:id
GET    /api/v1/businesses/:id/products
POST   /api/v1/businesses/:id/products
PATCH  /api/v1/businesses/:id/products/:productId
DELETE /api/v1/businesses/:id/products/:productId
PUT    /api/v1/businesses/:id/products/:productId/commission
GET    /api/v1/businesses/:id/subscriptions
POST   /api/v1/businesses/:id/subscriptions
PATCH  /api/v1/businesses/:id/subscriptions/:subId

GET    /api/v1/deliverers
POST   /api/v1/deliverers
GET    /api/v1/deliverers/:id
PATCH  /api/v1/deliverers/:id
DELETE /api/v1/deliverers/:id

GET    /api/v1/orders
POST   /api/v1/orders
GET    /api/v1/orders/:id
PATCH  /api/v1/orders/:id
PATCH  /api/v1/orders/:id/assign
PATCH  /api/v1/orders/:id/status

GET    /api/v1/settlements
POST   /api/v1/settlements/daily/generate
POST   /api/v1/settlements/weekly/generate
GET    /api/v1/settlements/:id
POST   /api/v1/settlements/:id/close

GET    /api/v1/dashboard/summary?range=today|week|month|6months|year&from=&to=
GET    /api/v1/reports/sales?range=...
GET    /api/v1/reports/top-businesses?range=...
GET    /api/v1/reports/top-deliverers?range=...

GET    /api/v1/config
PATCH  /api/v1/config                   (OWNER)
```

## 9. Preparado para crecer

- IDs `cuid()` (no enteros secuenciales expuestos salvo `orderNumber`, que es intencionalmente legible para el staff).
- Todo monto en `Decimal`, nunca `Float`.
- Índices en las columnas de filtro real: `status`, `orderDate`, `delivererId`, `active`.
- Snapshots de precio/comisión en las líneas de pedido → los reportes históricos no se corrompen si cambian tarifas.
- Paginación obligatoria en todos los `GET` de listado (se define en `shared/http`, no en cada módulo).
- Transacciones Prisma (`$transaction`) al crear pedidos y al cerrar cuadres, para evitar estados inconsistentes.
- `SystemConfig` permite tunear el negocio sin redeploy.
- Capa de reportes separada (`reports.repository.ts`) para poder optimizar/cachear agregaciones pesadas sin tocar el resto del sistema cuando el volumen crezca.

## 10. Diseño aprobado

1. ✅ `OPEN` = editable/recalculable, `CLOSED` = bloqueado (inmutable). Confirmado.
2. ✅ Se agregan los 3 timestamps puntuales en `Order` (`assignedAt`/`completedAt`/`cancelledAt`) para que los reportes filtren por fecha real de cada evento. Confirmado.

Diseño de dominio aprobado. Siguiente paso: scaffolder el proyecto — `package.json`, TypeScript, ESLint/Prettier, estructura de carpetas, `prisma/schema.prisma` real, y el primer módulo (`config` + `shared` + `auth`).
