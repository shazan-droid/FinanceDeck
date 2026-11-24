# FinanceDesk Security Specification (Phase 0 — Multi-User Isolation)

## Data Invariants
1. Any authenticated Google user with a verified email (`request.auth != null && request.auth.token.email_verified == true`) gets their own strictly isolated account under `/users/{userId}` where `userId == request.auth.uid`.
2. Users may never read, list, create, update, or delete another user's `/users/{otherUid}` profile or subcollections (`holdings`, `balances`, `transactions`, `indicators`, `appSettings`).
3. User profile documents must contain only allowed keys (`uid`, `email`, `displayName`, `preferredCurrency`, `createdAt`, `updatedAt`) with bounded string lengths and valid currency enum (`TZS`).
4. `uid`, `email`, and `createdAt` are immutable after creation; `createdAt` and `updatedAt` must match `request.time`.
5. All `/api/*` backend endpoints require a verified Firebase ID token (`verifyIdToken`) with `email_verified === true`, and route every SQLite DB query and receipt file read/write strictly into `data/users/<uid>/`.
6. `/users/{userId}/appSettings/general` strictly enforces `onboardingCompleted` (bool), `khumsEnabled` (bool), and a bounded `monthlyFixedExpenses` array (`size() <= 25`, each element having bounded `id`, `category`, `description`, and non-negative numeric `amount`).

## Dirty Dozen Payloads (Must Return PERMISSION_DENIED)
1. Unauthenticated read on `/users/{uid}`
2. Cross-user read: Authenticated User A reading `/users/{userB}` or `/users/{userB}/transactions/{id}`
3. Unverified email spoofing (`email_verified: false`)
4. Shadow field injection (`{ uid, email, preferredCurrency: "TZS", isAdmin: true }`)
5. Cross-UID write (`/users/{userB}` with `uid: request.auth.uid`)
6. Oversized `displayName` (> 120 chars)
7. Invalid `preferredCurrency` (`"EUR"`)
8. Mutating `email` or `uid` on update
9. Mutating `createdAt` on update
10. Client-forged `updatedAt` timestamp (`!= request.time`)
11. Collection list scraping on `/users`
12. Any write to `/test/connection` or unknown collection `/shadow/doc`
