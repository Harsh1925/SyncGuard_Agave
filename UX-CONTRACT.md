# Dashboard behavior contract

The UI is a local-only scaffold. Runtime source lives in `apps/dashboard/`.

| Capability | Canonical owner                        | Source of truth           | Allowed variants                           | Verification                     |
| ---------- | -------------------------------------- | ------------------------- | ------------------------------------------ | -------------------------------- |
| Form       | Native React form plus page validation | This contract             | Operation UUID / integer seed              | Browser lookup and invalid input |
| Scrollbar  | Global styles.css                      | DESIGN.md                 | Table horizontal overflow / evidence block | Narrow viewport                  |
| Toast      | components/Status.tsx                  | This contract             | Inline status / inline error               | Live-region feedback             |
| CRUD       | TypeScript API routes                  | Specification and OpenAPI | Chaos plan create only                     | API tests                        |

Links navigate between the two pages; operation IDs persist in the timeline URL.
Latest operations are bounded to 25; timelines are bounded to 100 in the starter UI.
Every request shows loading, success/empty or inline error and offers retry through the
same action. Requests time out after 15 seconds. Submits disable their action until settled.
Errors preserve inputs. Validation focuses the invalid field and exposes aria-invalid.
No destructive or process-killing actions are exposed in this starter UI.
The failure lab creates plans; it never claims a chaos run or invariant proof occurred.

React requests abort on navigation and discard stale responses. Shared request and resource
helpers own loading, timeout and error behavior. BrowserRouter owns routes / and /operations.
Worker faults remain CLI-only. Backend operational timestamps are serialized as UTC ISO strings.
