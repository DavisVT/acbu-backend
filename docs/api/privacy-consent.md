# CCPA/BIPA Privacy Consent API Documentation

This document describes the CCPA/BIPA privacy consent management endpoints, schema design, and security architecture in the ACBU Backend API.

---

## Overview

The Privacy Consent subsystem allows recipients and users to record and query CCPA (California Consumer Privacy Act) and BIPA (Biometric Information Privacy Act) privacy preferences, such as opt-outs for data sales, marketing, analytics, and explicit biometric consent.

To adhere to privacy-by-design principles, consent records are stored against a **hashed Stellar address** (`address_hash`). No plaintext wallet addresses are required or saved in the `privacy_consents` table, preventing address leakage and enabling blind indexing across subsystems.

---

## Privacy & Hashing Architecture

- **Address Hashing**: Address lookups use deterministic cryptographic hashing via `computeAddressHash(address: string): string` (SHA-256 / HMAC-SHA256).
- **Index Lookup**: `privacy_consents.address_hash` is indexed and marked `UNIQUE`, ensuring $O(1)$ fast lookups without exposing user wallet addresses.
- **Idempotency**: `PUT` operations enforce last-write-wins semantics. Each update updates the `updated_at` timestamp.

---

## API Endpoints

### 1. Update / Record Consent Preferences

`PUT /api/privacy/consent` or `PUT /api/v1/privacy/consent`

Records or updates consent preference flags for a given Stellar address.

#### Request Body
```json
{
  "address": "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
  "analytics_optout": true,
  "marketing_optout": true,
  "sale_optout": false,
  "biometric_consent": true
}
```

#### Field Specifications
| Parameter | Type | Required | Default | Description |
| :--- | :--- | :--- | :--- | :--- |
| `address` | String | **Yes** | N/A | Valid 56-character Stellar G-address |
| `analytics_optout` | Boolean | No | `false` | Opt-out of analytics data collection |
| `marketing_optout` | Boolean | No | `false` | Opt-out of marketing communications |
| `sale_optout` | Boolean | No | `false` | CCPA Do-Not-Sell opt-out |
| `biometric_consent` | Boolean | No | `false` | BIPA biometric data processing consent |

#### Response (200 OK)
```json
{
  "success": true,
  "message": "Consent preferences updated successfully",
  "data": {
    "address_hash": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    "analytics_optout": true,
    "marketing_optout": true,
    "sale_optout": false,
    "biometric_consent": true,
    "updated_at": "2026-07-25T11:00:00.000Z",
    "created_at": "2026-07-25T11:00:00.000Z"
  }
}
```

---

### 2. Query Consent Preferences

`GET /api/privacy/consent/:address` or `GET /api/v1/privacy/consent/:address`

Retrieves consent preferences for a given Stellar address or address hash.

#### Path Parameters
| Parameter | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `address` | String | **Yes** | Valid 56-char Stellar address (e.g. `G...`) or 64-char hex address hash |

#### Response (200 OK)
```json
{
  "success": true,
  "data": {
    "address_hash": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    "analytics_optout": true,
    "marketing_optout": true,
    "sale_optout": false,
    "biometric_consent": true,
    "updated_at": "2026-07-25T11:00:00.000Z",
    "created_at": "2026-07-25T11:00:00.000Z"
  }
}
```

#### Error Responses
- **400 Bad Request**: Invalid Stellar address format or malformed request payload.
- **404 Not Found**: No consent record exists for the provided address/hash.

---

## Security & Compliance Notes

1. **Zero Plaintext Storage**: Plaintext addresses are never written to `privacy_consents`.
2. **Schema Validation**: All input passes through Zod validation in `src/validation/schemas.ts`.
3. **No Unhandled Side Effects**: Database operations execute via Prisma upsert transactions.
