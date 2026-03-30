# TDX MCP Server Design

Design document for the TeamDynamix MCP server — the first real production use case for the Claude Agent SDK reference architecture at UI OIT. This MCP server exposes TDX REST API operations as tools that Claude agents can use directly.

## Overview

The first real project for this architecture: an MCP server exposing TeamDynamix REST API operations as tools that Claude agents can use directly.

## Architecture Decision: Standalone Process

The MCP server runs as a standalone Bun process, not embedded in the agent harness. Reasons:

- **Reusability**: Any Claude Code session or agent can connect to it, not just our harness
- **Testability**: Can be tested independently with MCP inspector tools
- **Deployment**: Can run as a service accessible to multiple developers
- **Standard MCP protocol**: Uses stdio transport by default, HTTP/SSE for remote deployment

## TDX API Client Abstraction

```typescript
// tdx-mcp-server/src/tdx-client.ts
import { z } from "zod";

// --- TDX API Response Schemas ---

export const TdxTicketSchema = z.object({
  ID: z.number(),
  Title: z.string(),
  Description: z.string().nullable(),
  StatusID: z.number(),
  StatusName: z.string().nullable(),
  PriorityID: z.number(),
  PriorityName: z.string().nullable(),
  RequestorUid: z.string().nullable(),
  RequestorName: z.string().nullable(),
  ResponsibleUid: z.string().nullable(),
  ResponsibleName: z.string().nullable(),
  ResponsibleGroupID: z.number().nullable(),
  ResponsibleGroupName: z.string().nullable(),
  TypeID: z.number(),
  TypeName: z.string().nullable(),
  FormID: z.number().nullable(),
  FormName: z.string().nullable(),
  AccountID: z.number().nullable(),
  AccountName: z.string().nullable(),
  SourceID: z.number().nullable(),
  SourceName: z.string().nullable(),
  CreatedDate: z.string(),
  ModifiedDate: z.string(),
  Attributes: z.array(z.object({
    ID: z.number(),
    Name: z.string(),
    Value: z.string().nullable(),
  })).optional(),
});

export type TdxTicket = z.infer<typeof TdxTicketSchema>;

export const TdxTicketSearchResultSchema = z.array(TdxTicketSchema);

export const TdxCommentSchema = z.object({
  ID: z.number().optional(),
  Body: z.string(),
  CreatedDate: z.string().optional(),
  CreatedUid: z.string().optional(),
  CreatedFullName: z.string().optional(),
  IsPrivate: z.boolean().default(false),
  Notify: z.array(z.string()).optional(),
});

export const TdxPaginatedResponseSchema = z.object({
  Items: z.array(TdxTicketSchema),
  TotalCount: z.number(),
  PageIndex: z.number(),
  PageSize: z.number(),
});

// --- TDX API Client ---

export class TdxClient {
  private baseUrl: string;
  private appId: number;
  private bearerToken: string;

  constructor(config: { baseUrl: string; appId: number; bearerToken: string }) {
    this.baseUrl = config.baseUrl.replace(/\/$/, "");
    this.appId = config.appId;
    this.bearerToken = config.bearerToken;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown,
    schema?: z.ZodType<T>
  ): Promise<T> {
    const url = `${this.baseUrl}/api/${path}`;
    const response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${this.bearerToken}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new TdxApiError(response.status, errorText, path);
    }

    const data = await response.json();
    return schema ? schema.parse(data) : (data as T);
  }

  // --- Ticket Operations ---

  async getTicket(ticketId: number): Promise<TdxTicket> {
    return this.request("GET", `${this.appId}/tickets/${ticketId}`, undefined, TdxTicketSchema);
  }

  async createTicket(ticket: {
    Title: string;
    Description?: string;
    TypeID: number;
    PriorityID?: number;
    StatusID?: number;
    RequestorUid?: string;
    ResponsibleUid?: string;
    AccountID?: number;
    Attributes?: Array<{ ID: number; Value: string }>;
  }): Promise<TdxTicket> {
    return this.request("POST", `${this.appId}/tickets`, ticket, TdxTicketSchema);
  }

  async updateTicket(ticketId: number, updates: {
    Title?: string;
    Description?: string;
    StatusID?: number;
    PriorityID?: number;
    ResponsibleUid?: string;
    ResponsibleGroupID?: number;
    Attributes?: Array<{ ID: number; Value: string }>;
  }): Promise<TdxTicket> {
    return this.request("PATCH", `${this.appId}/tickets/${ticketId}`, updates, TdxTicketSchema);
  }

  async searchTickets(params: {
    SearchText?: string;
    StatusIDs?: number[];
    PriorityIDs?: number[];
    TypeIDs?: number[];
    RequestorUids?: string[];
    ResponsibleUids?: string[];
    ResponsibleGroupIDs?: number[];
    CreatedDateFrom?: string;
    CreatedDateTo?: string;
    MaxResults?: number;
  }): Promise<TdxTicket[]> {
    return this.request("POST", `${this.appId}/tickets/search`, params, TdxTicketSearchResultSchema);
  }

  async updateTicketStatus(ticketId: number, statusId: number, comments?: string): Promise<void> {
    await this.request("PUT", `${this.appId}/tickets/${ticketId}/status`, {
      NewStatusID: statusId,
      Comments: comments,
    });
  }

  async assignTicket(ticketId: number, responsibleUid: string): Promise<TdxTicket> {
    return this.updateTicket(ticketId, { ResponsibleUid: responsibleUid });
  }

  async addComment(ticketId: number, comment: {
    Body: string;
    IsPrivate?: boolean;
    Notify?: string[];
  }): Promise<void> {
    await this.request("POST", `${this.appId}/tickets/${ticketId}/feed`, comment);
  }

  async getComments(ticketId: number): Promise<z.infer<typeof TdxCommentSchema>[]> {
    return this.request("GET", `${this.appId}/tickets/${ticketId}/feed`);
  }
}

export class TdxApiError extends Error {
  constructor(
    public statusCode: number,
    public responseBody: string,
    public path: string
  ) {
    super(`TDX API Error ${statusCode} on ${path}: ${responseBody}`);
    this.name = "TdxApiError";
  }
}
```

## MCP Tool Definitions

```typescript
// tdx-mcp-server/src/tools.ts
import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { TdxClient, TdxApiError } from "./tdx-client";

export function createTdxMcpServer(client: TdxClient) {

  const getTicket = tool(
    "get_ticket",
    "Get a TeamDynamix ticket by ID. Returns full ticket details including status, priority, assignee, and custom attributes.",
    { ticketId: z.number().describe("The TDX ticket ID") },
    async (args) => {
      try {
        const ticket = await client.getTicket(args.ticketId);
        return {
          content: [{ type: "text", text: JSON.stringify(ticket, null, 2) }],
        };
      } catch (e) {
        return handleTdxError(e);
      }
    },
    { annotations: { readOnlyHint: true } }
  );

  const searchTickets = tool(
    "search_tickets",
    "Search TeamDynamix tickets with filters. Returns matching tickets sorted by relevance.",
    {
      searchText: z.string().optional().describe("Free-text search query"),
      statusIds: z.array(z.number()).optional().describe("Filter by status IDs"),
      priorityIds: z.array(z.number()).optional().describe("Filter by priority IDs"),
      typeIds: z.array(z.number()).optional().describe("Filter by ticket type IDs"),
      responsibleUids: z.array(z.string()).optional().describe("Filter by assignee UIDs"),
      createdDateFrom: z.string().optional().describe("ISO 8601 start date"),
      createdDateTo: z.string().optional().describe("ISO 8601 end date"),
      maxResults: z.number().default(25).describe("Maximum results (default 25)"),
    },
    async (args) => {
      try {
        const tickets = await client.searchTickets({
          SearchText: args.searchText,
          StatusIDs: args.statusIds,
          PriorityIDs: args.priorityIds,
          TypeIDs: args.typeIds,
          ResponsibleUids: args.responsibleUids,
          CreatedDateFrom: args.createdDateFrom,
          CreatedDateTo: args.createdDateTo,
          MaxResults: args.maxResults,
        });
        return {
          content: [{
            type: "text",
            text: `Found ${tickets.length} tickets:\n${JSON.stringify(tickets, null, 2)}`,
          }],
        };
      } catch (e) {
        return handleTdxError(e);
      }
    },
    { annotations: { readOnlyHint: true } }
  );

  const createTicket = tool(
    "create_ticket",
    "Create a new TeamDynamix ticket. Requires at minimum a title and type ID.",
    {
      title: z.string().describe("Ticket title"),
      description: z.string().optional().describe("Ticket description (HTML allowed)"),
      typeId: z.number().describe("Ticket type ID"),
      priorityId: z.number().optional().describe("Priority ID"),
      statusId: z.number().optional().describe("Initial status ID"),
      requestorUid: z.string().optional().describe("Requestor UID"),
      responsibleUid: z.string().optional().describe("Assignee UID"),
      accountId: z.number().optional().describe("Account/department ID"),
      attributes: z.array(z.object({
        id: z.number().describe("Custom attribute ID"),
        value: z.string().describe("Attribute value"),
      })).optional().describe("Custom attribute values"),
    },
    async (args) => {
      try {
        const ticket = await client.createTicket({
          Title: args.title,
          Description: args.description,
          TypeID: args.typeId,
          PriorityID: args.priorityId,
          StatusID: args.statusId,
          RequestorUid: args.requestorUid,
          ResponsibleUid: args.responsibleUid,
          AccountID: args.accountId,
          Attributes: args.attributes?.map((a) => ({ ID: a.id, Value: a.value })),
        });
        return {
          content: [{ type: "text", text: `Created ticket #${ticket.ID}: ${ticket.Title}\n${JSON.stringify(ticket, null, 2)}` }],
        };
      } catch (e) {
        return handleTdxError(e);
      }
    },
    { annotations: { destructiveHint: true } }
  );

  const updateTicket = tool(
    "update_ticket",
    "Update an existing TeamDynamix ticket. Only provided fields are modified.",
    {
      ticketId: z.number().describe("Ticket ID to update"),
      title: z.string().optional(),
      description: z.string().optional(),
      statusId: z.number().optional(),
      priorityId: z.number().optional(),
      responsibleUid: z.string().optional(),
      responsibleGroupId: z.number().optional(),
    },
    async (args) => {
      try {
        const ticket = await client.updateTicket(args.ticketId, {
          Title: args.title,
          Description: args.description,
          StatusID: args.statusId,
          PriorityID: args.priorityId,
          ResponsibleUid: args.responsibleUid,
          ResponsibleGroupID: args.responsibleGroupId,
        });
        return {
          content: [{ type: "text", text: `Updated ticket #${ticket.ID}\n${JSON.stringify(ticket, null, 2)}` }],
        };
      } catch (e) {
        return handleTdxError(e);
      }
    },
    { annotations: { destructiveHint: true, idempotentHint: true } }
  );

  const addComment = tool(
    "add_comment",
    "Add a comment to a TeamDynamix ticket. Can be public or private.",
    {
      ticketId: z.number().describe("Ticket ID"),
      body: z.string().describe("Comment body (HTML allowed)"),
      isPrivate: z.boolean().default(false).describe("Whether the comment is private"),
      notify: z.array(z.string()).optional().describe("UIDs to notify"),
    },
    async (args) => {
      try {
        await client.addComment(args.ticketId, {
          Body: args.body,
          IsPrivate: args.isPrivate,
          Notify: args.notify,
        });
        return {
          content: [{ type: "text", text: `Comment added to ticket #${args.ticketId}` }],
        };
      } catch (e) {
        return handleTdxError(e);
      }
    },
    { annotations: { destructiveHint: true } }
  );

  const getComments = tool(
    "get_comments",
    "Get all comments/feed entries for a TeamDynamix ticket.",
    { ticketId: z.number().describe("Ticket ID") },
    async (args) => {
      try {
        const comments = await client.getComments(args.ticketId);
        return {
          content: [{ type: "text", text: JSON.stringify(comments, null, 2) }],
        };
      } catch (e) {
        return handleTdxError(e);
      }
    },
    { annotations: { readOnlyHint: true } }
  );

  const updateStatus = tool(
    "update_ticket_status",
    "Update the status of a TeamDynamix ticket with optional comment.",
    {
      ticketId: z.number().describe("Ticket ID"),
      statusId: z.number().describe("New status ID"),
      comments: z.string().optional().describe("Comment explaining the status change"),
    },
    async (args) => {
      try {
        await client.updateTicketStatus(args.ticketId, args.statusId, args.comments);
        return {
          content: [{ type: "text", text: `Status updated for ticket #${args.ticketId}` }],
        };
      } catch (e) {
        return handleTdxError(e);
      }
    },
    { annotations: { destructiveHint: true, idempotentHint: true } }
  );

  return createSdkMcpServer({
    name: "tdx",
    version: "0.1.0",
    tools: [getTicket, searchTickets, createTicket, updateTicket, addComment, getComments, updateStatus],
  });
}

function handleTdxError(e: unknown) {
  if (e instanceof TdxApiError) {
    return {
      content: [{
        type: "text" as const,
        text: `TDX API Error (${e.statusCode}): ${e.responseBody}`,
      }],
      isError: true,
    };
  }
  return {
    content: [{
      type: "text" as const,
      text: `Unexpected error: ${e instanceof Error ? e.message : String(e)}`,
    }],
    isError: true,
  };
}
```

## Server Entry Point

```typescript
// tdx-mcp-server/src/index.ts
import { TdxClient } from "./tdx-client";
import { createTdxMcpServer } from "./tools";

const client = new TdxClient({
  baseUrl: process.env.TDX_BASE_URL ?? "https://yourschool.teamdynamix.com",
  appId: parseInt(process.env.TDX_APP_ID ?? "0", 10),
  bearerToken: process.env.TDX_BEARER_TOKEN ?? "",
});

const server = createTdxMcpServer(client);

// When used as an in-process MCP server in the agent harness:
export { server as tdxServer };

// When used as a standalone MCP server:
// The SDK handles stdio transport when the file is executed directly
```

## How the Three-Agent Architecture Applies

**Planner**: Takes "Build an MCP server for TeamDynamix ticket operations" and produces `plan.json` with: tool definitions, authentication flow, error handling patterns, Zod schemas for TDX API responses, and a feature list covering each tool's happy path, error cases, and edge cases (pagination, rate limiting, invalid IDs).

**Generator**: Implements tools one at a time. Each tool gets: implementation, Zod schema for input/output, error handling with `isError: true`, and tests against a mock TDX API.

**Evaluator**: Connects to the MCP server, exercises each tool, and verifies: correct Zod validation of inputs, proper error handling for invalid inputs, correct HTTP method and URL construction, response schemas match TDX API documentation.

## Testing Strategy

**Development**: Mock TDX API using `Bun.serve()` that returns canned responses matching TDX schema shapes. Tests run against the mock.

**Integration**: Real TDX sandbox API. Tests create, read, update tickets in a designated test workspace. Run less frequently (CI only) due to API rate limits.

```typescript
// tdx-mcp-server/tests/mock-tdx-server.ts
export function createMockTdxServer(port = 9999) {
  return Bun.serve({
    port,
    fetch(req) {
      const url = new URL(req.url);

      if (url.pathname.endsWith("/tickets/12345")) {
        return Response.json({
          ID: 12345,
          Title: "Test Ticket",
          Description: "A test ticket",
          StatusID: 1,
          StatusName: "New",
          PriorityID: 2,
          PriorityName: "Medium",
          TypeID: 1,
          TypeName: "Incident",
          CreatedDate: "2026-03-29T00:00:00Z",
          ModifiedDate: "2026-03-29T00:00:00Z",
        });
      }

      return new Response("Not Found", { status: 404 });
    },
  });
}
```

## Additional Architecture Decisions

**Pagination**: TDX search results paginate. The MCP tool handles this transparently — if `maxResults` exceeds a single page, the tool makes multiple requests and concatenates results. The agent sees a single response.

**Rate Limiting**: Implement exponential backoff with jitter in the `TdxClient.request()` method. Return rate limit errors as `isError: true` so the agent can wait and retry.

**Authentication**: TDX bearer tokens expire. The client should support token refresh via a callback or environment variable reload. For the initial implementation, assume long-lived tokens from the TDX admin console.

---

> **See also**: [Main Reference Architecture](./claude-agent-sdk-reference-architecture.md) · [Hello World Guide](./hello-world-guide.md)
