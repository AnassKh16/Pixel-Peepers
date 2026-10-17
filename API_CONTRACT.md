# API Contract

The single source of truth between `backend/` (Laptop 1) and `mobile/` (Laptop 2).
Agree on it in the first 15 minutes. Change it only by talking to each other first,
then update this file in the same commit as the code change.

## Basics
- **Base URL (local, phone on hotspot):** `http://<LAPTOP1_IP>:3000`  (Windows Mobile Hotspot host is usually `192.168.137.1`)
- **Base URL (inside docker compose):** `http://backend:3000`
- **Format:** JSON in, JSON out. Header `Content-Type: application/json`.
- **Auth:** `Authorization: Bearer <token>` on every endpoint marked "Auth: yes".
- **Times:** ISO 8601 UTC strings, e.g. `2026-10-17T10:45:00Z`.
- **IDs:** <integer | UUID string> (pick one, write it here).

## Standard error format (every error, every endpoint)
```json
{ "error": { "code": "VALIDATION_ERROR", "message": "human readable text", "details": {} } }
```
| HTTP | code | When |
|---|---|---|
| 400 | VALIDATION_ERROR | Missing or bad field |
| 401 | UNAUTHORIZED | No / bad token |
| 403 | FORBIDDEN | Logged in but not allowed |
| 404 | NOT_FOUND | Resource does not exist |
| 409 | CONFLICT | Duplicate or state clash |
| 500 | INTERNAL_ERROR | Bug on our side |

## Endpoints

### GET /health
- **Auth:** no
- **Response 200:** `{ "status": "ok" }`
- **Req IDs:** (infrastructure)

### <METHOD> <path>
- **Purpose:** <one line>
- **Auth:** yes / no
- **Request JSON:**
```json
{ }
```
- **Response <code> JSON:**
```json
{ }
```
- **Errors:** <which codes from the table above>
- **Req IDs:** <P1-Rxx from TRACEABILITY.md>
- **Test:** <tests/... :: test_name>

### <METHOD> <path>
- **Purpose:**
- **Auth:**
- **Request JSON:**
```json
{ }
```
- **Response <code> JSON:**
```json
{ }
```
- **Errors:**
- **Req IDs:**
- **Test:**

## Real-time / events (only if the problem needs them)
| Channel / topic | Direction | Payload JSON | When sent |
|---|---|---|---|
| | server -> app | | |

## Change log
| Time | Change | Agreed by |
|---|---|---|
| | | |
