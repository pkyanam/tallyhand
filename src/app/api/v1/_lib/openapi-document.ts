import { settingsPatchJsonSchema } from "../../../../../cli/src/settings-schema";
/**
 * Embedded OpenAPI 3.1 document for Tallyhand API v1.
 *
 * Served by `../openapi.json/route.ts`. Kept here (API-owned path) so the
 * agent surface documents filters, sorting, pagination, snake_case aliases,
 * dry-run, idempotency, bulk endpoints, errors, and examples in one place.
 *
 * Agent quick-start:
 * - Auth: `Authorization: Bearer <TALLYHAND_API_TOKEN>` on every route
 *   except GET /health and GET /openapi.json. No token configured on the
 *   server -> 503 api_disabled.
 * - Envelope: success -> `{ data, meta? }`, errors ->
 *   `{ error: { code, message, details? } }`.
 * - Lists: `?limit=` (default 50, max 200) + `?cursor=`; response
 *   `meta.nextCursor` is null when done. `?sort=<field>` / `?sort=-<field>`
 *   for descending (invalid field -> 400 naming the allowed fields).
 * - Dates in bodies and `?date_from=`/`?date_to=`: ms epoch or ISO-8601.
 * - Query aliases: snake_case mirrors exist for `client_id`, `project_id`,
 *   `is_billed`, `include_archived`.
 * - Mutations: POST/PATCH/PUT accept `Idempotency-Key`; a replayed key
 *   returns the stored response (200/201) without re-executing.
 * - `?dry_run=true` previews deletes, invoice send/paid, scheduler runs,
 *   and per-schedule runs — nothing is mutated and dry runs never consume
 *   idempotency keys.
 * - Invoice lifecycle is drafts only: create starts as draft (initial
 *   status must be draft/omitted), status changes only via
 *   POST /invoices/{id}/send then POST /invoices/{id}/paid. PATCH never
 *   accepts status.
 * - Deleting a draft invoice unclaims its billed tasks/expenses.
 * - Deletion guards return 409 with per-relation counts in
 *   error.details when related records exist.
 */
export const OPENAPI_V1 = {
  openapi: "3.1.0",
  info: {
    title: "Tallyhand API",
    version: "v1",
    description:
      "Local-first freelance time-tracking & invoicing. All agent surfaces " +
      "(REST, CLI, MCP) share these semantics: JSON envelope, bearer token " +
      "auth, idempotent mutations, dry-run previews, and guard-railed deletes.",
  },
  servers: [{ url: "/api/v1", description: "Same-origin API base" }],
  security: [{ bearerAuth: [] }],
  tags: [
    { name: "clients" },
    { name: "projects" },
    { name: "tasks" },
    { name: "expenses" },
    { name: "invoices" },
    { name: "recurring" },
    { name: "retainers" },
    { name: "scheduler" },
    { name: "settings" },
    { name: "meta" },
  ],
  paths: {
    "/health": {
      get: {
        tags: ["meta"],
        security: [],
        summary: "Health check (no auth)",
        responses: {
          "200": {
            description: "ok",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Health" },
              },
            },
          },
        },
      },
    },
    "/openapi.json": {
      get: {
        tags: ["meta"],
        security: [],
        summary: "This OpenAPI document (no auth)",
        responses: { "200": { description: "OpenAPI 3.1 document" } },
      },
    },
    "/clients": {
      get: {
        tags: ["clients"],
        summary: "List clients",
        parameters: [
          { $ref: "#/components/parameters/Limit" },
          { $ref: "#/components/parameters/Cursor" },
          { $ref: "#/components/parameters/Search" },
          {
            name: "includeArchived",
            in: "query",
            schema: { type: "boolean" },
            description: "Include archived clients. Alias: include_archived.",
          },
          {
            name: "sort",
            in: "query",
            schema: { type: "string" },
            description: "One of: name, -name, createdAt, -createdAt.",
          },
        ],
        responses: {
          "200": {
            description: "Client list",
            content: {
              "application/json": {
                schema: {
                  allOf: [
                    { $ref: "#/components/schemas/Envelope" },
                    {
                      type: "object",
                      properties: {
                        data: {
                          type: "array",
                          items: { $ref: "#/components/schemas/Client" },
                        },
                      },
                    },
                  ],
                },
              },
            },
          },
        },
      },
      post: {
        tags: ["clients"],
        summary: "Create a client",
        parameters: [{ $ref: "#/components/parameters/IdempotencyKey" }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ClientInput" },
            },
          },
        },
        responses: {
          "201": {
            description: "Created",
            content: {
              "application/json": {
                schema: {
                  allOf: [
                    { $ref: "#/components/schemas/Envelope" },
                    {
                      type: "object",
                      properties: { data: { $ref: "#/components/schemas/Client" } },
                    },
                  ],
                },
              },
            },
          },
          "400": { $ref: "#/components/responses/BadRequest" },
        },
      },
    },
    "/clients/{id}": {
      get: {
        tags: ["clients"],
        summary: "Get a client",
        parameters: [{ $ref: "#/components/parameters/Id" }],
        responses: {
          "200": {
            description: "Client",
            content: {
              "application/json": {
                schema: {
                  allOf: [
                    { $ref: "#/components/schemas/Envelope" },
                    {
                      type: "object",
                      properties: { data: { $ref: "#/components/schemas/Client" } },
                    },
                  ],
                },
              },
            },
          },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
      patch: {
        tags: ["clients"],
        summary: "Patch a client",
        parameters: [
          { $ref: "#/components/parameters/Id" },
          { $ref: "#/components/parameters/IdempotencyKey" },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ClientPatch" },
            },
          },
        },
        responses: {
          "200": { description: "Updated client" },
          "400": { $ref: "#/components/responses/BadRequest" },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
      delete: {
        tags: ["clients"],
        summary: "Delete a client",
        description:
          "Refused with 409 (error.details has projectCount, invoiceCount, " +
          "expenseCount, scheduleCount, retainerCount) while related records " +
          "exist. Supports ?dry_run=true.",
        parameters: [
          { $ref: "#/components/parameters/Id" },
          { $ref: "#/components/parameters/DryRun" },
        ],
        responses: {
          "204": { description: "Deleted" },
          "200": { description: "Dry-run preview" },
          "404": { $ref: "#/components/responses/NotFound" },
          "409": { $ref: "#/components/responses/Conflict" },
        },
      },
    },
    "/projects": {
      get: {
        tags: ["projects"],
        summary: "List projects",
        parameters: [
          { $ref: "#/components/parameters/Limit" },
          { $ref: "#/components/parameters/Cursor" },
          {
            name: "clientId",
            in: "query",
            schema: { type: "string" },
            description: "Filter by client. Alias: client_id.",
          },
          { $ref: "#/components/parameters/Search" },
          {
            name: "includeArchived",
            in: "query",
            schema: { type: "boolean" },
            description: "Alias: include_archived.",
          },
          {
            name: "sort",
            in: "query",
            schema: { type: "string" },
            description: "One of: name, -name, createdAt, -createdAt.",
          },
        ],
        responses: { "200": { description: "Project list" } },
      },
      post: {
        tags: ["projects"],
        summary: "Create a project",
        parameters: [{ $ref: "#/components/parameters/IdempotencyKey" }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ProjectInput" },
            },
          },
        },
        responses: {
          "201": { description: "Created" },
          "400": { $ref: "#/components/responses/BadRequest" },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
    },
    "/projects/{id}": {
      get: {
        tags: ["projects"],
        summary: "Get a project",
        parameters: [{ $ref: "#/components/parameters/Id" }],
        responses: {
          "200": { description: "Project" },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
      patch: {
        tags: ["projects"],
        summary: "Patch a project",
        parameters: [
          { $ref: "#/components/parameters/Id" },
          { $ref: "#/components/parameters/IdempotencyKey" },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ProjectPatch" },
            },
          },
        },
        responses: {
          "200": { description: "Updated project" },
          "400": { $ref: "#/components/responses/BadRequest" },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
      delete: {
        tags: ["projects"],
        summary: "Delete a project",
        description:
          "Refused with 409 while tasks, expenses, or recurring schedules " +
          "reference it. Supports ?dry_run=true.",
        parameters: [
          { $ref: "#/components/parameters/Id" },
          { $ref: "#/components/parameters/DryRun" },
        ],
        responses: {
          "204": { description: "Deleted" },
          "200": { description: "Dry-run preview" },
          "404": { $ref: "#/components/responses/NotFound" },
          "409": { $ref: "#/components/responses/Conflict" },
        },
      },
    },
    "/tasks": {
      get: {
        tags: ["tasks"],
        summary: "List time entries",
        parameters: [
          { $ref: "#/components/parameters/Limit" },
          { $ref: "#/components/parameters/Cursor" },
          {
            name: "projectId",
            in: "query",
            schema: { type: "string" },
            description: "Alias: project_id.",
          },
          {
            name: "clientId",
            in: "query",
            schema: { type: "string" },
            description: "Alias: client_id.",
          },
          {
            name: "isBilled",
            in: "query",
            schema: { type: "boolean" },
            description: "Alias: is_billed.",
          },
          { $ref: "#/components/parameters/DateFrom" },
          { $ref: "#/components/parameters/DateTo" },
          {
            name: "sort",
            in: "query",
            schema: { type: "string" },
            description:
              "One of: startAt, -startAt, endAt, -endAt, durationMinutes, " +
              "-durationMinutes, name, -name, createdAt, -createdAt.",
          },
        ],
        responses: { "200": { description: "Task list" } },
      },
      post: {
        tags: ["tasks"],
        summary: "Create a time entry",
        description:
          "endAt: 0 (or omitted) means an open/running timer. Otherwise " +
          "endAt must be >= startAt.",
        parameters: [{ $ref: "#/components/parameters/IdempotencyKey" }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/TaskInput" },
              examples: {
                closed: {
                  value: {
                    projectId: "prj_1",
                    name: "Design review",
                    startAt: 1758326400000,
                    endAt: 1758330000000,
                    durationMinutes: 60,
                    tags: ["design"],
                  },
                },
                openTimer: {
                  value: { projectId: "prj_1", name: "Deep work", startAt: 1758330000000, endAt: 0 },
                },
              },
            },
          },
        },
        responses: {
          "201": { description: "Created" },
          "400": { $ref: "#/components/responses/BadRequest" },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
    },
    "/tasks/{id}": {
      get: {
        tags: ["tasks"],
        summary: "Get a time entry",
        parameters: [{ $ref: "#/components/parameters/Id" }],
        responses: {
          "200": { description: "Task" },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
      patch: {
        tags: ["tasks"],
        summary: "Patch a time entry",
        description:
          "Same endAt rule as create: 0 = open timer, otherwise endAt >= " +
          "startAt. Accepts Idempotency-Key.",
        parameters: [
          { $ref: "#/components/parameters/Id" },
          { $ref: "#/components/parameters/IdempotencyKey" },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/TaskPatch" },
            },
          },
        },
        responses: {
          "200": { description: "Updated task" },
          "400": { $ref: "#/components/responses/BadRequest" },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
      delete: {
        tags: ["tasks"],
        summary: "Delete a time entry",
        description:
          "Refused with 409 when the task is billed. Supports ?dry_run=true.",
        parameters: [
          { $ref: "#/components/parameters/Id" },
          { $ref: "#/components/parameters/DryRun" },
        ],
        responses: {
          "204": { description: "Deleted" },
          "200": { description: "Dry-run preview" },
          "404": { $ref: "#/components/responses/NotFound" },
          "409": { $ref: "#/components/responses/Conflict" },
        },
      },
    },
    "/tasks/bulk": {
      post: {
        tags: ["tasks"],
        summary: "Bulk-create time entries (max 200)",
        description:
          "Accepts { items: [...] } or a bare JSON array. Every item is " +
          "validated before the first write (schema + projectId exists + " +
          "endAt rule); any failure returns 400 with per-index details and " +
          "creates nothing. The whole batch shares one Idempotency-Key.",
        parameters: [{ $ref: "#/components/parameters/IdempotencyKey" }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                anyOf: [
                  {
                    type: "object",
                    required: ["items"],
                    properties: {
                      items: {
                        type: "array",
                        maxItems: 200,
                        items: { $ref: "#/components/schemas/TaskInput" },
                      },
                    },
                  },
                  {
                    type: "array",
                    maxItems: 200,
                    items: { $ref: "#/components/schemas/TaskInput" },
                  },
                ],
              },
            },
          },
        },
        responses: {
          "201": { description: "All items created" },
          "400": { $ref: "#/components/responses/BadRequest" },
        },
      },
    },
    "/expenses": {
      get: {
        tags: ["expenses"],
        summary: "List expenses",
        parameters: [
          { $ref: "#/components/parameters/Limit" },
          { $ref: "#/components/parameters/Cursor" },
          {
            name: "clientId",
            in: "query",
            schema: { type: "string" },
            description: "Alias: client_id.",
          },
          {
            name: "projectId",
            in: "query",
            schema: { type: "string" },
            description: "Alias: project_id.",
          },
          { name: "category", in: "query", schema: { type: "string" } },
          {
            name: "isBilled",
            in: "query",
            schema: { type: "boolean" },
            description: "Alias: is_billed.",
          },
          { $ref: "#/components/parameters/DateFrom" },
          { $ref: "#/components/parameters/DateTo" },
          {
            name: "sort",
            in: "query",
            schema: { type: "string" },
            description:
              "One of: date, -date, amount, -amount, category, -category, " +
              "createdAt, -createdAt.",
          },
        ],
        responses: { "200": { description: "Expense list" } },
      },
      post: {
        tags: ["expenses"],
        summary: "Create an expense",
        description: "Money is in dollars (amount, rate); only *Cents fields are integer cents.",
        parameters: [{ $ref: "#/components/parameters/IdempotencyKey" }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ExpenseInput" },
            },
          },
        },
        responses: {
          "201": { description: "Created" },
          "400": { $ref: "#/components/responses/BadRequest" },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
    },
    "/expenses/{id}": {
      get: {
        tags: ["expenses"],
        summary: "Get an expense",
        parameters: [{ $ref: "#/components/parameters/Id" }],
        responses: {
          "200": { description: "Expense" },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
      patch: {
        tags: ["expenses"],
        summary: "Patch an expense",
        parameters: [
          { $ref: "#/components/parameters/Id" },
          { $ref: "#/components/parameters/IdempotencyKey" },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ExpensePatch" },
            },
          },
        },
        responses: {
          "200": { description: "Updated expense" },
          "400": { $ref: "#/components/responses/BadRequest" },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
      delete: {
        tags: ["expenses"],
        summary: "Delete an expense",
        description:
          "Refused with 409 when the expense is billed. Supports ?dry_run=true.",
        parameters: [
          { $ref: "#/components/parameters/Id" },
          { $ref: "#/components/parameters/DryRun" },
        ],
        responses: {
          "204": { description: "Deleted" },
          "200": { description: "Dry-run preview" },
          "404": { $ref: "#/components/responses/NotFound" },
          "409": { $ref: "#/components/responses/Conflict" },
        },
      },
    },
    "/expenses/bulk": {
      post: {
        tags: ["expenses"],
        summary: "Bulk-create expenses (max 200)",
        description:
          "Same validated-before-write contract as /tasks/bulk. Accepts " +
          "{ items: [...] } or a bare JSON array.",
        parameters: [{ $ref: "#/components/parameters/IdempotencyKey" }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                anyOf: [
                  {
                    type: "object",
                    required: ["items"],
                    properties: {
                      items: {
                        type: "array",
                        maxItems: 200,
                        items: { $ref: "#/components/schemas/ExpenseInput" },
                      },
                    },
                  },
                  {
                    type: "array",
                    maxItems: 200,
                    items: { $ref: "#/components/schemas/ExpenseInput" },
                  },
                ],
              },
            },
          },
        },
        responses: {
          "201": { description: "All items created" },
          "400": { $ref: "#/components/responses/BadRequest" },
        },
      },
    },
    "/invoices": {
      get: {
        tags: ["invoices"],
        summary: "List invoices",
        parameters: [
          { $ref: "#/components/parameters/Limit" },
          { $ref: "#/components/parameters/Cursor" },
          {
            name: "clientId",
            in: "query",
            schema: { type: "string" },
            description: "Alias: client_id.",
          },
          {
            name: "status",
            in: "query",
            schema: { type: "string", enum: ["draft", "sent", "paid"] },
          },
          {
            name: "overdue",
            in: "query",
            schema: { type: "boolean" },
            description: "Only sent invoices past their due date.",
          },
          { $ref: "#/components/parameters/DateFrom" },
          { $ref: "#/components/parameters/DateTo" },
          {
            name: "sort",
            in: "query",
            schema: { type: "string" },
            description:
              "One of: issueDate, -issueDate, dueDate, -dueDate, total, " +
              "-total, invoiceNumber, -invoiceNumber, createdAt, -createdAt.",
          },
        ],
        responses: { "200": { description: "Invoice list" } },
      },
      post: {
        tags: ["invoices"],
        summary: "Draft an invoice",
        description:
          "Always creates a draft. An initial status other than draft/omitted " +
          "is rejected with 400. Line items may reference tasks/expenses via " +
          "sourceType + sourceId; those are marked billed only when the " +
          "invoice is sent.",
        parameters: [{ $ref: "#/components/parameters/IdempotencyKey" }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/InvoiceInput" },
              examples: {
                draft: {
                  value: {
                    clientId: "cli_1",
                    issueDate: 1758326400000,
                    dueDate: 1760918400000,
                    lineItems: [
                      {
                        description: "Design work",
                        quantity: 10,
                        rate: 150,
                        sourceType: "task",
                        sourceId: "tsk_1",
                      },
                    ],
                  },
                },
              },
            },
          },
        },
        responses: {
          "201": { description: "Draft created" },
          "400": { $ref: "#/components/responses/BadRequest" },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
    },
    "/invoices/{id}": {
      get: {
        tags: ["invoices"],
        summary: "Get an invoice",
        parameters: [{ $ref: "#/components/parameters/Id" }],
        responses: {
          "200": { description: "Invoice" },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
      patch: {
        tags: ["invoices"],
        summary: "Patch a draft invoice (never status)",
        description:
          "status is not an accepted field — use /send and /paid. " +
          "Accepts Idempotency-Key.",
        parameters: [
          { $ref: "#/components/parameters/Id" },
          { $ref: "#/components/parameters/IdempotencyKey" },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/InvoicePatch" },
            },
          },
        },
        responses: {
          "200": { description: "Updated invoice" },
          "400": { $ref: "#/components/responses/BadRequest" },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
      delete: {
        tags: ["invoices"],
        summary: "Delete a draft invoice",
        description:
          "Only drafts can be deleted (409 otherwise). Deleting a draft " +
          "unclaims its billed tasks/expenses. Supports ?dry_run=true.",
        parameters: [
          { $ref: "#/components/parameters/Id" },
          { $ref: "#/components/parameters/DryRun" },
        ],
        responses: {
          "204": { description: "Deleted" },
          "200": { description: "Dry-run preview" },
          "404": { $ref: "#/components/responses/NotFound" },
          "409": { $ref: "#/components/responses/Conflict" },
        },
      },
    },
    "/invoices/{id}/pdf": {
      get: { tags: ["invoices"], summary: "Download the saved invoice PDF without changing its status",
        parameters: [{ $ref: "#/components/parameters/Id" }],
        responses: { "200": { description: "Invoice PDF", content: { "application/pdf": { schema: { type: "string", format: "binary" } } } }, "404": { description: "Invoice not found" } } },
    },
    "/invoices/{id}/share": {
      post: { tags: ["invoices"], summary: "Enable or disable the invoice's cloud link",
        description: "Enabled links expose the saved invoice and PDF to anyone with the URL. Disable revokes previous links. Re-enable issues a fresh link.",
        parameters: [{ $ref: "#/components/parameters/Id" }, { $ref: "#/components/parameters/IdempotencyKey" }],
        requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["enabled"], properties: { enabled: { type: "boolean" } } } } } },
        responses: { "200": { description: "Sharing state and shareUrl/pdfUrl" }, "404": { description: "Invoice not found" } } },
    },
    "/invoices/{id}/send": {
      post: {
        tags: ["invoices"],
        summary: "Send an invoice (draft -> sent)",
        description:
          "Marks referenced tasks/expenses billed. Refused with 409 on a " +
          "paid invoice. Supports ?dry_run=true (previews wouldSetStatus and " +
          "wouldMarkBilled without mutating).",
        parameters: [
          { $ref: "#/components/parameters/Id" },
          { $ref: "#/components/parameters/DryRun" },
        ],
        responses: {
          "200": { description: "Sent" },
          "404": { $ref: "#/components/responses/NotFound" },
          "409": { $ref: "#/components/responses/Conflict" },
        },
      },
    },
    "/invoices/{id}/paid": {
      post: {
        tags: ["invoices"],
        summary: "Mark an invoice paid (sent -> paid)",
        description:
          "Requires sent status first (409 on draft). Supports ?dry_run=true.",
        parameters: [
          { $ref: "#/components/parameters/Id" },
          { $ref: "#/components/parameters/DryRun" },
        ],
        responses: {
          "200": { description: "Marked paid" },
          "404": { $ref: "#/components/responses/NotFound" },
          "409": { $ref: "#/components/responses/Conflict" },
        },
      },
    },
    "/recurring-schedules": {
      get: {
        tags: ["recurring"],
        summary: "List recurring schedules",
        parameters: [
          { $ref: "#/components/parameters/Limit" },
          { $ref: "#/components/parameters/Cursor" },
          {
            name: "status",
            in: "query",
            schema: { type: "string", enum: ["active", "paused", "ended"] },
          },
          {
            name: "clientId",
            in: "query",
            schema: { type: "string" },
            description: "Alias: client_id.",
          },
          {
            name: "sort",
            in: "query",
            schema: { type: "string" },
            description: "One of: nextRunAt, -nextRunAt, name, -name, createdAt, -createdAt.",
          },
        ],
        responses: { "200": { description: "Schedule list" } },
      },
      post: {
        tags: ["recurring"],
        summary: "Create a recurring schedule",
        description:
          "mode=fixed generates a draft invoice each run; mode=unbilled " +
          "sweeps unbilled tasks/expenses for the client into a draft.",
        parameters: [{ $ref: "#/components/parameters/IdempotencyKey" }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/RecurringScheduleInput" },
            },
          },
        },
        responses: {
          "201": { description: "Created" },
          "400": { $ref: "#/components/responses/BadRequest" },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
    },
    "/recurring-schedules/{id}": {
      get: {
        tags: ["recurring"],
        summary: "Get a recurring schedule",
        parameters: [{ $ref: "#/components/parameters/Id" }],
        responses: {
          "200": { description: "Schedule" },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
      patch: {
        tags: ["recurring"],
        summary: "Patch a recurring schedule",
        parameters: [
          { $ref: "#/components/parameters/Id" },
          { $ref: "#/components/parameters/IdempotencyKey" },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/RecurringSchedulePatch" },
            },
          },
        },
        responses: {
          "200": { description: "Updated schedule" },
          "400": { $ref: "#/components/responses/BadRequest" },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
      delete: {
        tags: ["recurring"],
        summary: "Delete a recurring schedule",
        description:
          "Refused with 409 while a retainer references it. Supports " +
          "?dry_run=true.",
        parameters: [
          { $ref: "#/components/parameters/Id" },
          { $ref: "#/components/parameters/DryRun" },
        ],
        responses: {
          "204": { description: "Deleted" },
          "200": { description: "Dry-run preview" },
          "404": { $ref: "#/components/responses/NotFound" },
          "409": { $ref: "#/components/responses/Conflict" },
        },
      },
    },
    "/recurring-schedules/{id}/run": {
      post: {
        tags: ["recurring"],
        summary: "Force-run one schedule",
        description:
          "Generates now even if not due. Supports ?dry_run=true " +
          "(previews wouldCreateInvoice and occurrence counts).",
        parameters: [
          { $ref: "#/components/parameters/Id" },
          { $ref: "#/components/parameters/DryRun" },
        ],
        responses: {
          "200": { description: "Run result" },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
    },
    "/retainers": {
      get: {
        tags: ["retainers"],
        summary: "List retainers",
        parameters: [
          { $ref: "#/components/parameters/Limit" },
          { $ref: "#/components/parameters/Cursor" },
          {
            name: "status",
            in: "query",
            schema: { type: "string", enum: ["active", "paused", "depleted", "ended"] },
          },
          {
            name: "clientId",
            in: "query",
            schema: { type: "string" },
            description: "Alias: client_id.",
          },
          {
            name: "type",
            in: "query",
            schema: { type: "string", enum: ["prepaid-hours", "monthly-fee"] },
          },
          {
            name: "sort",
            in: "query",
            schema: { type: "string" },
            description: "One of: startDate, -startDate, name, -name, createdAt, -createdAt.",
          },
        ],
        responses: { "200": { description: "Retainer list" } },
      },
      post: {
        tags: ["retainers"],
        summary: "Create a retainer",
        description:
          "amountCents is integer cents (unlike the rest of the API, which " +
          "uses dollars). Optional recurringScheduleId links an auto-renewing " +
          "retainer to its schedule.",
        parameters: [{ $ref: "#/components/parameters/IdempotencyKey" }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/RetainerInput" },
            },
          },
        },
        responses: {
          "201": { description: "Created" },
          "400": { $ref: "#/components/responses/BadRequest" },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
    },
    "/retainers/{id}": {
      get: {
        tags: ["retainers"],
        summary: "Get a retainer",
        parameters: [{ $ref: "#/components/parameters/Id" }],
        responses: {
          "200": { description: "Retainer" },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
      patch: {
        tags: ["retainers"],
        summary: "Patch a retainer",
        parameters: [
          { $ref: "#/components/parameters/Id" },
          { $ref: "#/components/parameters/IdempotencyKey" },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/RetainerPatch" },
            },
          },
        },
        responses: {
          "200": { description: "Updated retainer" },
          "400": { $ref: "#/components/responses/BadRequest" },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
      delete: {
        tags: ["retainers"],
        summary: "Delete a retainer",
        description: "Supports ?dry_run=true.",
        parameters: [
          { $ref: "#/components/parameters/Id" },
          { $ref: "#/components/parameters/DryRun" },
        ],
        responses: {
          "204": { description: "Deleted" },
          "200": { description: "Dry-run preview" },
          "404": { $ref: "#/components/responses/NotFound" },
        },
      },
    },
    "/scheduler/run": {
      post: {
        tags: ["scheduler"],
        summary: "Run due recurring schedules",
        description:
          "Generates draft invoices for every due schedule and advances " +
          "their nextRunAt. Safe to call repeatedly — nothing due means " +
          "nothing generated. Supports ?dry_run=true (previews due " +
          "schedules without creating or advancing).",
        parameters: [{ $ref: "#/components/parameters/DryRun" }],
        responses: {
          "200": {
            description: "Run results",
            content: {
              "application/json": {
                schema: {
                  allOf: [
                    { $ref: "#/components/schemas/Envelope" },
                    {
                      type: "object",
                      properties: {
                        data: {
                          type: "object",
                          properties: {
                            generated: {
                              type: "array",
                              items: { type: "string" },
                              description: "Invoice ids created this run.",
                            },
                            results: {
                              type: "array",
                              items: {
                                type: "object",
                                properties: {
                                  scheduleId: { type: "string" },
                                  invoiceId: { type: ["string", "null"] },
                                  nextRunAt: { type: "number" },
                                  occurrences: { type: "number" },
                                },
                              },
                            },
                            dryRun: { type: "boolean" },
                            due: {
                              type: "array",
                              description: "Dry-run preview entries.",
                              items: {
                                type: "object",
                                properties: {
                                  scheduleId: { type: "string" },
                                  wouldCreateInvoice: { type: "boolean" },
                                  occurrences: { type: "number" },
                                },
                              },
                            },
                          },
                        },
                      },
                    },
                  ],
                },
              },
            },
          },
        },
      },
    },
    "/settings": {
      get: {
        tags: ["settings"],
        summary: "Get server settings",
        responses: { "200": { description: "Settings" } },
      },
      patch: {
        tags: ["settings"],
        summary: "Update server settings",
        parameters: [{ $ref: "#/components/parameters/IdempotencyKey" }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/SettingsPatch" },
            },
          },
        },
        responses: {
          "200": { description: "Updated settings" },
          "400": { $ref: "#/components/responses/BadRequest" },
        },
      },
    },
  },
  components: {
    securitySchemes: {
      bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "opaque" },
    },
    parameters: {
      Id: {
        name: "id",
        in: "path",
        required: true,
        schema: { type: "string" },
      },
      Limit: {
        name: "limit",
        in: "query",
        schema: { type: "integer", minimum: 1, maximum: 200, default: 50 },
      },
      Cursor: {
        name: "cursor",
        in: "query",
        schema: { type: "string" },
        description: "Opaque cursor; follow meta.nextCursor until null.",
      },
      Search: {
        name: "search",
        in: "query",
        schema: { type: "string" },
        description: "Case-insensitive substring match on name (and email/notes where present).",
      },
      DateFrom: {
        name: "date_from",
        in: "query",
        schema: { type: "string" },
        description: "ms epoch or ISO-8601; invalid values -> 400.",
      },
      DateTo: {
        name: "date_to",
        in: "query",
        schema: { type: "string" },
        description: "ms epoch or ISO-8601; invalid values -> 400.",
      },
      DryRun: {
        name: "dry_run",
        in: "query",
        schema: { type: "boolean" },
        description:
          "Preview only: returns what would happen without mutating. " +
          "Dry runs never consume idempotency keys.",
      },
      IdempotencyKey: {
        name: "Idempotency-Key",
        in: "header",
        schema: { type: "string" },
        description:
          "Optional client token (uuid recommended). Replaying a key " +
          "returns the stored response without re-executing.",
      },
    },
    responses: {
      BadRequest: {
        description: "Validation failed",
        content: {
          "application/json": { schema: { $ref: "#/components/schemas/Error" } },
        },
      },
      NotFound: {
        description: "Not found",
        content: {
          "application/json": { schema: { $ref: "#/components/schemas/Error" } },
        },
      },
      Conflict: {
        description: "Lifecycle or referential guard refused the change",
        content: {
          "application/json": { schema: { $ref: "#/components/schemas/Error" } },
        },
      },
      Unauthorized: {
        description: "Missing/invalid bearer token",
        content: {
          "application/json": { schema: { $ref: "#/components/schemas/Error" } },
        },
      },
    },
    schemas: {
      Envelope: {
        type: "object",
        properties: {
          meta: {
            type: "object",
            properties: {
              nextCursor: { type: ["string", "null"] },
              limit: { type: "number" },
            },
          },
        },
      },
      Error: {
        type: "object",
        required: ["error"],
        properties: {
          error: {
            type: "object",
            required: ["code", "message"],
            properties: {
              code: {
                type: "string",
                enum: [
                  "unauthorized",
                  "api_disabled",
                  "bad_request",
                  "not_found",
                  "conflict",
                  "validation",
                ],
              },
              message: { type: "string" },
              details: { description: "Per-index or per-relation details." },
            },
          },
        },
      },
      Health: {
        type: "object",
        properties: { data: { type: "object", properties: { status: { type: "string" } } } },
      },
      Client: {
        type: "object",
        properties: {
          id: { type: "string" },
          name: { type: "string" },
          email: { type: "string" },
          address: { type: "string" },
          defaultRate: { type: "number", description: "Dollars per hour." },
          notes: { type: "string" },
          archived: { type: "boolean" },
          createdAt: { type: "number" },
          updatedAt: { type: "number" },
        },
      },
      ClientInput: {
        type: "object",
        required: ["name"],
        properties: {
          id: { type: "string", description: "Optional custom id." },
          name: { type: "string" },
          email: { type: "string", format: "email" },
          address: { type: "string" },
          defaultRate: { type: "number", minimum: 0 },
          notes: { type: "string" },
          archived: { type: "boolean" },
        },
      },
      ClientPatch: {
        type: "object",
        properties: {
          name: { type: "string" },
          email: { type: "string", format: "email" },
          address: { type: "string" },
          defaultRate: { type: "number", minimum: 0 },
          notes: { type: "string" },
          archived: { type: "boolean" },
        },
      },
      Project: {
        type: "object",
        properties: {
          id: { type: "string" },
          clientId: { type: "string" },
          name: { type: "string" },
          rateOverride: { type: "number", description: "Dollars per hour." },
          archived: { type: "boolean" },
          createdAt: { type: "number" },
          updatedAt: { type: "number" },
        },
      },
      ProjectInput: {
        type: "object",
        required: ["clientId", "name"],
        properties: {
          id: { type: "string" },
          clientId: { type: "string" },
          name: { type: "string" },
          rateOverride: { type: "number", minimum: 0 },
          archived: { type: "boolean" },
        },
      },
      ProjectPatch: {
        type: "object",
        properties: {
          clientId: { type: "string" },
          name: { type: "string" },
          rateOverride: { type: "number", minimum: 0 },
          archived: { type: "boolean" },
        },
      },
      Task: {
        type: "object",
        properties: {
          id: { type: "string" },
          projectId: { type: "string" },
          name: { type: "string" },
          startAt: { type: "number", description: "ms epoch." },
          endAt: { type: "number", description: "ms epoch; 0 = open/running timer." },
          durationMinutes: { type: "number" },
          notes: { type: "string" },
          tags: { type: "array", items: { type: "string" } },
          isBilled: { type: "boolean" },
          invoiceId: { type: "string" },
          createdAt: { type: "number" },
          updatedAt: { type: "number" },
        },
      },
      TaskInput: {
        type: "object",
        required: ["projectId", "name", "startAt", "endAt"],
        properties: {
          id: { type: "string" },
          projectId: { type: "string" },
          name: { type: "string" },
          startAt: { type: "number" },
          endAt: { type: "number", description: "0 = open timer; otherwise >= startAt." },
          durationMinutes: { type: "number", minimum: 0 },
          notes: { type: "string" },
          tags: { type: "array", items: { type: "string" } },
          isBilled: { type: "boolean" },
        },
      },
      TaskPatch: {
        type: "object",
        properties: {
          projectId: { type: "string" },
          name: { type: "string" },
          startAt: { type: "number" },
          endAt: { type: "number" },
          durationMinutes: { type: "number", minimum: 0 },
          notes: { type: "string" },
          tags: { type: "array", items: { type: "string" } },
          isBilled: { type: "boolean" },
        },
      },
      Expense: {
        type: "object",
        properties: {
          id: { type: "string" },
          clientId: { type: "string" },
          projectId: { type: "string" },
          date: { type: "number", description: "ms epoch." },
          amount: { type: "number", description: "Dollars." },
          category: { type: "string" },
          note: { type: "string" },
          receiptB64: { type: "string" },
          isBilled: { type: "boolean" },
          invoiceId: { type: "string" },
          createdAt: { type: "number" },
          updatedAt: { type: "number" },
        },
      },
      ExpenseInput: {
        type: "object",
        required: ["date", "amount", "category"],
        properties: {
          id: { type: "string" },
          clientId: { type: "string" },
          projectId: { type: "string" },
          date: { type: "number" },
          amount: { type: "number", minimum: 0 },
          category: { type: "string" },
          note: { type: "string" },
          receiptB64: { type: "string" },
          isBilled: { type: "boolean" },
        },
      },
      ExpensePatch: {
        type: "object",
        properties: {
          clientId: { type: "string" },
          projectId: { type: "string" },
          date: { type: "number" },
          amount: { type: "number", minimum: 0 },
          category: { type: "string" },
          note: { type: "string" },
          receiptB64: { type: "string" },
          isBilled: { type: "boolean" },
        },
      },
      LineItem: {
        type: "object",
        properties: {
          id: { type: "string" },
          description: { type: "string" },
          quantity: { type: "number" },
          rate: { type: "number", description: "Dollars." },
          amount: { type: "number" },
          markupPercent: { type: "number" },
          sourceType: { type: "string", enum: ["task", "expense", "manual"] },
          sourceId: { type: "string" },
          taxRate: { type: "number", description: "Per-line tax rate, percent." },
          taxLabel: { type: "string" },
        },
      },
      LineItemInput: {
        type: "object",
        required: ["description", "quantity", "rate"],
        properties: {
          id: { type: "string" },
          description: { type: "string" },
          quantity: { type: "number", minimum: 0 },
          rate: { type: "number", minimum: 0 },
          amount: { type: "number", minimum: 0 },
          markupPercent: { type: "number" },
          sourceType: { type: "string", enum: ["task", "expense", "manual"] },
          sourceId: { type: "string" },
          taxRate: { type: "number", minimum: 0, maximum: 100 },
          taxLabel: { type: "string" },
        },
      },
      Invoice: {
        type: "object",
        properties: {
          cloudLinkEnabled: { type: "boolean", description: "Cloud link enabled by default on create; false keeps the invoice private." },
          shareUrl: { type: ["string", "null"], description: "Canonical public URL on create/get/update responses." },
          pdfUrl: { type: ["string", "null"], description: "Direct public PDF URL; null when sharing is disabled or unavailable." },
          id: { type: "string" },
          clientId: { type: "string" },
          invoiceNumber: { type: "string" },
          issueDate: { type: "number" },
          dueDate: { type: "number" },
          status: { type: "string", enum: ["draft", "sent", "paid"] },
          lineItems: { type: "array", items: { $ref: "#/components/schemas/LineItem" } },
          subtotal: { type: "number" },
          total: { type: "number", description: "Dollars." },
          notes: { type: "string" },
          publicToken: { type: "string" },
          currency: { type: "string", description: "ISO 4217 code." },
          taxRegion: { type: "string", enum: ["US", "EU"] },
          sellerTaxId: { type: "string" },
          sellerTaxIdLabel: { type: "string" },
          buyerTaxId: { type: "string" },
          sellerEmailVisible: { type: "boolean" },
          buyerEmailVisible: { type: "boolean" },
          serviceStart: { type: "number" },
          serviceEnd: { type: "number" },
          invoiceType: { type: "string" },
          paymentMethod: { type: "string" },
          paymentUrl: { type: "string" },
          bankAccount: { type: "string" },
          swiftBic: { type: "string" },
          qrEnabled: { type: "boolean" },
          qrPayload: { type: "string" },
          qrDescription: { type: "string" },
          amountInWords: { type: "boolean" },
          template: { type: "string", enum: ["default", "stripe"] },
          createdAt: { type: "number" },
          updatedAt: { type: "number" },
        },
      },
      InvoiceInput: {
        type: "object",
        required: ["clientId", "issueDate", "lineItems"],
        properties: {
          cloudLinkEnabled: { type: "boolean", description: "Cloud link enabled by default on create; false keeps the invoice private." },
          id: { type: "string" },
          clientId: { type: "string" },
          invoiceNumber: { type: "string" },
          issueDate: { type: "number" },
          dueDate: { type: "number" },
          status: {
            type: "string",
            enum: ["draft", "sent", "paid"],
            description: "Only draft (or omitted) is accepted on create.",
          },
          lineItems: { type: "array", items: { $ref: "#/components/schemas/LineItemInput" } },
          subtotal: { type: "number", minimum: 0 },
          total: { type: "number", minimum: 0 },
          notes: { type: "string" },
          publicToken: { type: "string" },
          currency: { type: "string", description: "ISO 4217 code. Defaults to the workspace default currency." },
          taxRegion: { type: "string", enum: ["US", "EU"], description: "US = sales tax, Letter. EU = VAT, A4, SEPA QR." },
          sellerTaxId: { type: "string" },
          sellerTaxIdLabel: { type: "string" },
          buyerTaxId: { type: "string" },
          sellerEmailVisible: { type: "boolean" },
          buyerEmailVisible: { type: "boolean" },
          serviceStart: { type: "number" },
          serviceEnd: { type: "number" },
          invoiceType: { type: "string" },
          paymentMethod: { type: "string" },
          paymentUrl: { type: "string" },
          bankAccount: { type: "string", description: "IBAN for EU invoices." },
          swiftBic: { type: "string" },
          qrEnabled: { type: "boolean" },
          qrPayload: { type: "string" },
          qrDescription: { type: "string" },
          amountInWords: { type: "boolean" },
          template: { type: "string", enum: ["default", "stripe"] },
        },
      },
      InvoicePatch: {
        type: "object",
        description: "status is not accepted here — use /send and /paid.",
        properties: {
          cloudLinkEnabled: { type: "boolean", description: "Cloud link enabled by default on create; false keeps the invoice private." },
          clientId: { type: "string" },
          invoiceNumber: { type: "string" },
          issueDate: { type: "number" },
          dueDate: { type: "number" },
          lineItems: { type: "array", items: { $ref: "#/components/schemas/LineItemInput" } },
          subtotal: { type: "number", minimum: 0 },
          total: { type: "number", minimum: 0 },
          notes: { type: "string" },
          currency: { type: "string" },
          taxRegion: { type: "string", enum: ["US", "EU"] },
          sellerTaxId: { type: "string" },
          sellerTaxIdLabel: { type: "string" },
          buyerTaxId: { type: "string" },
          sellerEmailVisible: { type: "boolean" },
          buyerEmailVisible: { type: "boolean" },
          serviceStart: { type: "number" },
          serviceEnd: { type: "number" },
          invoiceType: { type: "string" },
          paymentMethod: { type: "string" },
          paymentUrl: { type: "string" },
          bankAccount: { type: "string" },
          swiftBic: { type: "string" },
          qrEnabled: { type: "boolean" },
          qrPayload: { type: "string" },
          qrDescription: { type: "string" },
          amountInWords: { type: "boolean" },
          template: { type: "string", enum: ["default", "stripe"] },
        },
      },
      RecurringSchedule: {
        type: "object",
        properties: {
          id: { type: "string" },
          clientId: { type: "string" },
          projectId: { type: "string" },
          name: { type: "string" },
          mode: { type: "string", enum: ["fixed", "unbilled"] },
          frequency: { type: "string", enum: ["weekly", "monthly", "quarterly", "yearly"] },
          interval: { type: "number" },
          lineItems: { type: "array", items: { $ref: "#/components/schemas/LineItem" } },
          startDate: { type: "number" },
          endDate: { type: "number" },
          maxOccurrences: { type: "number" },
          occurrences: { type: "number" },
          nextRunAt: { type: "number" },
          lastRunAt: { type: "number" },
          status: { type: "string", enum: ["active", "paused", "ended"] },
          notes: { type: "string" },
          createdAt: { type: "number" },
          updatedAt: { type: "number" },
        },
      },
      RecurringScheduleInput: {
        type: "object",
        required: ["clientId", "name", "mode", "frequency", "interval", "lineItems", "startDate"],
        properties: {
          id: { type: "string" },
          clientId: { type: "string" },
          projectId: { type: "string" },
          name: { type: "string" },
          mode: { type: "string", enum: ["fixed", "unbilled"] },
          frequency: { type: "string", enum: ["weekly", "monthly", "quarterly", "yearly"] },
          interval: { type: "number", minimum: 1 },
          lineItems: { type: "array", items: { $ref: "#/components/schemas/LineItemInput" } },
          startDate: { type: "number" },
          endDate: { type: "number" },
          maxOccurrences: { type: "number", minimum: 1 },
          status: { type: "string", enum: ["active", "paused", "ended"] },
          notes: { type: "string" },
        },
      },
      RecurringSchedulePatch: {
        type: "object",
        properties: {
          clientId: { type: "string" },
          projectId: { type: "string" },
          name: { type: "string" },
          mode: { type: "string", enum: ["fixed", "unbilled"] },
          frequency: { type: "string", enum: ["weekly", "monthly", "quarterly", "yearly"] },
          interval: { type: "number", minimum: 1 },
          lineItems: { type: "array", items: { $ref: "#/components/schemas/LineItemInput" } },
          startDate: { type: "number" },
          endDate: { type: "number" },
          maxOccurrences: { type: "number", minimum: 1 },
          status: { type: "string", enum: ["active", "paused", "ended"] },
          notes: { type: "string" },
        },
      },
      Retainer: {
        type: "object",
        properties: {
          id: { type: "string" },
          clientId: { type: "string" },
          name: { type: "string" },
          type: { type: "string", enum: ["prepaid-hours", "monthly-fee"] },
          totalHours: { type: "number" },
          amountCents: { type: "number", description: "Integer cents." },
          hourlyRate: { type: "number" },
          startDate: { type: "number" },
          endDate: { type: "number" },
          status: { type: "string", enum: ["active", "paused", "depleted", "ended"] },
          recurringScheduleId: { type: "string" },
          notes: { type: "string" },
          createdAt: { type: "number" },
          updatedAt: { type: "number" },
        },
      },
      RetainerInput: {
        type: "object",
        required: ["clientId", "name", "type", "amountCents", "startDate"],
        properties: {
          id: { type: "string" },
          clientId: { type: "string" },
          name: { type: "string" },
          type: { type: "string", enum: ["prepaid-hours", "monthly-fee"] },
          totalHours: { type: "number", minimum: 0 },
          amountCents: { type: "number", minimum: 0, description: "Integer cents." },
          hourlyRate: { type: "number", minimum: 0 },
          startDate: { type: "number" },
          endDate: { type: "number" },
          status: { type: "string", enum: ["active", "paused", "depleted", "ended"] },
          recurringScheduleId: { type: "string" },
          notes: { type: "string" },
        },
      },
      RetainerPatch: {
        type: "object",
        properties: {
          clientId: { type: "string" },
          name: { type: "string" },
          type: { type: "string", enum: ["prepaid-hours", "monthly-fee"] },
          totalHours: { type: "number", minimum: 0 },
          amountCents: { type: "number", minimum: 0 },
          hourlyRate: { type: "number", minimum: 0 },
          startDate: { type: "number" },
          endDate: { type: "number" },
          status: { type: "string", enum: ["active", "paused", "depleted", "ended"] },
          recurringScheduleId: { type: "string" },
          notes: { type: "string" },
        },
      },
      SettingsPatch: settingsPatchJsonSchema,
    },
  },
} as const;
