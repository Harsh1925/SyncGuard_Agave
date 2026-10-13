# Dashboard behavior contract

Runtime source lives in `apps/dashboard/`. Exactly two pages: System Health and Operation
Timeline / Failure Lab. Business authority: `SyncGuard_Specification.docx`, sections 11–19.

| Capability     | Canonical owner                              | Source of truth                   | Allowed variants                                | Verification                     |
| -------------- | -------------------------------------------- | --------------------------------- | ----------------------------------------------- | -------------------------------- |
| Form           | Native React form plus API/domain validation | API Zod schemas and this contract | UUID, seed/steps, synthetic document            | Browser invalid seed and ingress |
| Select/Listbox | Native HTML select                           | DESIGN.md and this contract       | Named crash boundary / extraction mode          | Keyboard/native select           |
| Scrollbar      | Global styles.css                            | DESIGN.md                         | Table overflow / evidence blocks                | Narrow viewport                  |
| Toast          | components/Status.tsx                        | This contract                     | Inline status / inline error                    | Live-region feedback             |
| CRUD           | TypeScript API routes and lib/useAction.ts   | Specification and OpenAPI         | Execute chaos / inject drift / replay / ingress | Integration and browser checks   |

Links navigate between the two pages. Operation IDs persist in the timeline URL. The
latest operations are bounded to 25; audit history supports loading subsequent pages.
Lab history is bounded to 20 runs, with a three-second refresh after each settled read.
Busy submissions disable their action; inputs survive errors. Invalid seed/step validation
focuses the affected field. Shared resource/action hooks own cancellation, stale-result
suppression, request timeout and inline status. Financial refusal displays deterministic
reasons returned by the API. Users retain the ingress operation ID for uncertain retries;
editing a proposal requires choosing a new operation ID.

Failure execution is disabled unless server capabilities identify the isolated demo
configuration. Named hooks kill child workers, never the API process. A started run is
monitored through persisted status; navigation does not cancel accepted work. Invariants
remain unexecuted until assertions pass. Fault/drift controls are disabled during a run.
Drift injection explains the synthetic amount and ERP authority before the action. Replay
is available only for failed operations. All buttons use explicit action verbs.

Business source traceability: permission/controls come from `chaos/simulator.ts` and
`api/app.ts`; invoice acceptance rules come from `ingress/service.ts` and the specification
section 19. No billing, legal, or session-policy flow applies to this local demo. UTC
operational timestamps are displayed explicitly; no reverse Job synchronization is added.
