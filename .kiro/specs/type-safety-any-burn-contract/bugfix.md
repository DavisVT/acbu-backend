# Bugfix Requirements Document

## Introduction

Four locations in `controllers/burnController.ts` and `services/stellar/contractClient.ts` use the `any` type with the comment "Using any to avoid type issues". This suppresses TypeScript's type checker in hot-code paths that touch financial transactions and Stellar/Soroban RPC calls. The fix replaces each `any` with a precise, statically-verifiable type so that incorrect property accesses, missing fields, and mismatched return values are caught at compile time rather than at runtime.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN `respondFromExistingBurnTx` receives a Prisma transaction record THEN the `tx` parameter is typed as `any`, suppressing type checking on all accessed fields (`tx.id`, `tx.acbuAmountBurned`, `tx.localAmount`, `tx.localCurrency`, `tx.fee`, `tx.rateSnapshot`, `tx.status`, `tx.createdAt`).

1.2 WHEN `rpcServer.sendTransaction` is called inside `_invokeContractInner` THEN the result is stored in `let send: any`, suppressing type checking on `send.hash` and preventing the compiler from verifying that the response is a valid `rpc.Api.SendTransactionResponse`.

1.3 WHEN `parseTransactionResult` receives the `getTransaction` response THEN the `result` parameter is typed as `any`, allowing arbitrary property access on `result.result_xdr`, `result.resultXdr` without compile-time safety.

1.4 WHEN `toScVal` converts a JavaScript value to an XDR `ScVal` THEN the `value` parameter is typed as `any`, accepting inputs the function cannot actually handle (e.g., plain objects, `null`) without a compile-time error.

1.5 WHEN `fromScVal` converts an XDR `ScVal` to a JavaScript value THEN the return type is `any`, causing callers to lose all type information about the returned value.

### Expected Behavior (Correct)

2.1 WHEN `respondFromExistingBurnTx` receives a Prisma transaction record THEN the `tx` parameter SHALL be typed as the Prisma-generated `Transaction` type from `@prisma/client`, so that access to any non-existent field produces a compile-time error.

2.2 WHEN `rpcServer.sendTransaction` is called inside `_invokeContractInner` THEN the result SHALL be stored in a variable typed as `rpc.Api.SendTransactionResponse`, so that access to `send.hash` and other response fields is statically verified.

2.3 WHEN `parseTransactionResult` receives the `getTransaction` response THEN the `result` parameter SHALL be typed with a discriminated union or interface that explicitly covers both the Horizon shape (`result_xdr: string`) and the Soroban RPC `getTransaction` shape (`resultXdr: string | xdr.TransactionResult`), so that only declared properties are accessible without a cast.

2.4 WHEN `toScVal` converts a JavaScript value THEN the `value` parameter SHALL use a union type (`string | number | bigint | boolean | Uint8Array | ScValInput[]`) that matches only the cases the function body handles, so that passing an unsupported type produces a compile-time error.

2.5 WHEN `fromScVal` converts an XDR `ScVal` THEN the return type SHALL be a union type (`string | number | bigint | boolean | Uint8Array | xdr.ScVal | ScValOutput[] | null`) that accurately describes every value the switch statement can return, replacing the opaque `any`.

### Unchanged Behavior (Regression Prevention)

3.1 WHEN `respondFromExistingBurnTx` is called with a valid Prisma `Transaction` object THEN the system SHALL CONTINUE TO serialize the response JSON with the same fields (`transaction_id`, `acbu_amount`, `local_amount`, `currency`, `fee`, `rate`, `status`, `estimated_completion`, `blockchain_tx_hash`).

3.2 WHEN a Soroban transaction is submitted and confirmed THEN the system SHALL CONTINUE TO return a `ContractInvokeResult` with the correct `transactionHash`, `result`, and `ledger` values.

3.3 WHEN `parseTransactionResult` is called with a Horizon-shaped result (`result_xdr`) or a Soroban RPC-shaped result (`resultXdr`) THEN the system SHALL CONTINUE TO parse and return the correct `xdr.ScVal`.

3.4 WHEN `toScVal` is called with a `string`, `number`, `bigint`, `boolean`, `Uint8Array`, or `Array` value THEN the system SHALL CONTINUE TO produce the same `xdr.ScVal` output as before the fix.

3.5 WHEN `fromScVal` is called with any `xdr.ScVal` THEN the system SHALL CONTINUE TO return the same JavaScript value as before the fix.

3.6 WHEN the burn endpoint processes an idempotent request (duplicate idempotency key or duplicate `blockchain_tx_hash`) THEN the system SHALL CONTINUE TO respond with the existing transaction record without creating a duplicate.
