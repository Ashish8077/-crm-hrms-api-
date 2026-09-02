# Application Architecture Rules

## Mongoose Schema Conventions

### Schema Decorator

Every schema uses:

```typescript
@Schema({
  collection: '<collection_name>',
  timestamps: true,
  versionKey: false,
})
```

- `collection` — explicit snake_case collection name
- `timestamps` — auto-managed `createdAt` / `updatedAt`
- `versionKey: false` — disables the `__v` field

### Field Definitions

- Use `@Prop({ ... })` with explicit `type` for every field.
- Use definite assignment assertion (`!`) for required and defaulted fields.
- Use optional (`?`) only for truly optional fields with no default.
- Use `select: false` for sensitive fields that should not be returned by default (e.g., `passwordHash`).

### Indexing Strategy

| Requirement                | Where to define        |
| -------------------------- | ---------------------- |
| Normal field               | `@Prop`                |
| Queryable single field     | `@Prop({ index: true })` |
| Unique single field        | `@Prop({ unique: true })` |
| Compound index             | `Schema.index()`       |
| Compound unique constraint | `Schema.index()`       |
| Named index                | `Schema.index()`       |
| Partial / sparse index     | `Schema.index()`       |
| TTL index                  | `Schema.index()`       |

**Key rules:**

- `unique: true` already creates an index. Do **not** additionally specify `index: true` on the same field.
- Single-field indexes belong in `@Prop`. Compound indexes belong in `Schema.index()`.
- Compound indexes should have explicit `name` values following the convention:
  - Unique: `uq_<collection>_<fields>` (e.g., `uq_permissions_module_action`)
  - Non-unique: `idx_<collection>_<fields>` (e.g., `idx_roles_system_active`)

### Avoiding Redundant Indexes

Do not create two unique indexes that enforce the same business rule.

Example: if `key = module.action` (e.g., `employees.view`), then a unique index on `key` and a compound unique index on `{ module, action }` are redundant. Pick one canonical unique identifier — prefer `key`.

---

## RBAC Architecture

### Permission Model

- **Canonical identifier**: `key` field (e.g., `employees.view`, `users.create`)
- `key` is derived from `module.action`
- `module` — the application module (e.g., `employees`, `users`, `roles`)
- `action` — the operation (defined by `PermissionAction` enum: `view`, `create`, `edit`, `delete`, `export`, `approve`, `assign`)
- `isActive` — soft-enable/disable without deleting

### Role Model

- `key` — unique role identifier (e.g., `super_admin`)
- `name` — human-readable display name (e.g., `Super Admin`)
- `permissionIds` — array of `ObjectId` references to `Permission`
- `isSystemRole` — marks seed/built-in roles that should not be deleted
- `isActive` — soft-enable/disable without deleting

### User → Role Relationship

- Each user has a single `roleId` field referencing `Role`.
- This is a many-to-one relationship (many users can share the same role).

---

## Environment & Configuration

### Environment Files

```
.env.example            ✅ committed (template with safe placeholder values)
.env.development        ❌ gitignored (real local credentials)
.env.test               ❌ gitignored (real test credentials)
.env.production         ❌ gitignored (real production credentials)
```

- `.env.example` is the template for new developers. It contains variable names and safe placeholder values (e.g., `SUPER_ADMIN_PASSWORD=CHANGE_ME`), never real credentials.
- Actual `.env.*` files contain real credentials and stay local — they are never committed.
- Loaded via `ConfigModule` with per-environment file selection.

### Gitignore Pattern

```gitignore
.env
.env.*
!.env.example
```

This ignores all `.env` variants except `.env.example`.

### Configuration Structure

- Joi validation in `src/config/env.validation.ts`
- Typed configuration in `src/config/configuration.ts` with nested namespaces (`app`, `database`, `superAdmin`)
- Access via `configService.getOrThrow<T>('namespace.key')`

---

## Error Handling

### Error Codes

- Defined as a `const` object in `src/common/errors/error-codes.ts`
- Type extracted via `typeof ErrorCode[keyof typeof ErrorCode]`

### AppError

- Custom error class extending `Error`
- Constructor: `(code: ErrorCode, message: string, statusCode?: HttpStatus, details?: unknown)`
- Used throughout the application for domain-specific errors

### Global Exception Filter

- Catches all exceptions (`@Catch()`)
- Maps `AppError` and `HttpException` to standardized JSON responses
- Logs 5xx errors with request context
- Response format:

  ```json
  {
    "success": false,
    "error": {
      "code": "ERROR_CODE",
      "message": "Human-readable message",
      "details": {}
    },
    "requestId": "uuid"
  }
  ```

---

## Swagger / OpenAPI

- Configuration in `src/config/swagger.config.ts`
- Swagger UI at `/docs`
- OpenAPI JSON at `/docs/json`
- JWT bearer auth scheme named `access-token`
- `@nestjs/swagger` version must match the NestJS major version (e.g., NestJS 11 → Swagger 11)
- Do **not** use custom `operationIdFactory` — the default `ControllerName_methodName` avoids duplicate operation IDs

---

## Global Middleware & Interceptors

Initialization order in `main.ts`:

1. `app.enableShutdownHooks()`
2. `app.use(helmet())`
3. `app.setGlobalPrefix(API_PREFIX)`
4. `app.useGlobalPipes(new ValidationPipe(...))`
5. `app.enableCors(...)`
6. `app.useGlobalInterceptors(RequestIdInterceptor, LoggingInterceptor)`
7. `app.useGlobalFilters(GlobalExceptionFilter)`
8. `setupSwagger(app)`
9. `app.listen(port)`

---

## Git & Security

- Never commit real credentials (database URIs, JWT secrets, API keys, passwords).
- `.env.example` is the only environment file that is committed — it is a template, not a live configuration.
- All other `.env.*` files are gitignored.
- Super Admin credentials in `.env.example` must use safe placeholders:

  ```
  SUPER_ADMIN_EMAIL=admin@example.com
  SUPER_ADMIN_PASSWORD=CHANGE_ME
  ```

- Real values go only in local `.env.development` / deployment environment variables.
