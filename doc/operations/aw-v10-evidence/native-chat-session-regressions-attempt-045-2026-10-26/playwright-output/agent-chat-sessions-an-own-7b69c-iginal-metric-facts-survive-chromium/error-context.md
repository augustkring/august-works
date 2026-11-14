# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: agent-chat-sessions.spec.ts >> an owner can explicitly recover after source visibility is lost while original metric facts survive
- Location: tests/e2e/agent-chat-sessions.spec.ts:215:1

# Error details

```
Error: Context source access is unavailable
```

# Test source

```ts
  1  | export class HttpError extends Error {
  2  |   status: number;
  3  |   details?: unknown;
  4  | 
  5  |   constructor(status: number, message: string, details?: unknown) {
  6  |     super(message);
  7  |     this.status = status;
  8  |     this.details = details;
  9  |   }
  10 | }
  11 | 
  12 | export function badRequest(message: string, details?: unknown) {
  13 |   return new HttpError(400, message, details);
  14 | }
  15 | 
  16 | export function unauthorized(message = "Unauthorized") {
  17 |   return new HttpError(401, message);
  18 | }
  19 | 
  20 | export function forbidden(message = "Forbidden", details?: unknown) {
> 21 |   return new HttpError(403, message, details);
     |          ^ Error: Context source access is unavailable
  22 | }
  23 | 
  24 | export function notFound(message = "Not found", details?: unknown) {
  25 |   return new HttpError(404, message, details);
  26 | }
  27 | 
  28 | export function conflict(message: string, details?: unknown) {
  29 |   return new HttpError(409, message, details);
  30 | }
  31 | 
  32 | export function payloadTooLarge(message: string, details?: unknown) {
  33 |   return new HttpError(413, message, details);
  34 | }
  35 | 
  36 | export function unsupportedMediaType(message: string, details?: unknown) {
  37 |   return new HttpError(415, message, details);
  38 | }
  39 | 
  40 | export function unprocessable(message: string, details?: unknown) {
  41 |   return new HttpError(422, message, details);
  42 | }
  43 | 
  44 | export function tooManyRequests(message = "Too many requests", details?: unknown) {
  45 |   return new HttpError(429, message, details);
  46 | }
  47 | 
  48 | /** Native owner proof of refusal before any import effect, never a DTO flag. */
  49 | export class ImportPreflightError extends HttpError {}
  50 | 
  51 | export class ImportSourceChangedError extends ImportPreflightError {
  52 |   constructor() {
  53 |     super(409, "The package changed after preview. Preview it again before importing.", { code: "import_preview_source_changed" });
  54 |   }
  55 | }
  56 | 
```