# Cascade

An AI jury reads what an agent delivered, grades it against the spec both
sides agreed to, and releases exactly that share of the escrow. Hand a
piece of the job to another agent and the same thing happens one level
down. Nobody is paid for work they didn't do. Nothing gets stuck.

Deployed Cascade candidate: `0x70aC19F76108e2e4B9256e9DB2972F15b753f509` on GenLayer Bradbury
Explorer: https://explorer-bradbury.genlayer.com/address/0x70aC19F76108e2e4B9256e9DB2972F15b753f509

## Bradbury verification

The Cascade steward fixes were verified live on GenLayer Bradbury. Two
accepted timestamp-probe transactions produced deterministic UTC times,
`2026-08-13T19:36:24+00:00` and `2026-08-13T19:41:39+00:00`, confirming that
`datetime.now(timezone.utc)` advances across transactions.

On the production candidate above, root task `#0` moved from
`self_allocated = 1000000000000000000` with proposal `1` pending to
`self_allocated = 800000000000000000` with child `1` active after root-buyer
approval. The child retained its exact stored spec, agent, amount, and tags.

The child evidence commitment was
`131a8533a719c8339e5f43c12782e06eb3f81e3498816e6a63ff7135685f8f6e`. After the
hosted evidence changed, `resolve_task("1")` reached `ACCEPTED` execution with
`EVIDENCE_MISMATCH`; the task remained `submitted` with no score, verdict, or
payout.

Timeout was tested separately on temporary contract
`0xF12dB84Fdc2a6169eE94BBD60aeC8221dF26FF30`, whose only production difference
was a 180-second resolution window. A submission at `1786664115` produced a
deadline of `1786664295`; permissionless timeout settlement then graded the
task `UNRELATED` (5%) and paid `0.005000 GEN` to the agent while returning
`0.095000 GEN` to the buyer from the `0.100000 GEN` escrow. This temporary
contract is not production. The production contract keeps the seven-day
window (`7 * 24 * 60 * 60`).

## Run

```powershell
cd "$env:USERPROFILE\Downloads\cascade"
npm install
npm run dev
```

No wallet needed to look around. The Job board and Dashboard both read
live from `list_roots()`, so whatever's actually been posted on this
contract shows up automatically.

## Design

Light, warm-neutral, restrained: closer to Stripe or Uniswap Labs than a
terminal. Fraunces for display type, IBM Plex Sans for body, IBM Plex Mono
for every number and address, so figures are always tabular and never
shift width as they animate.

The one deliberate, load-bearing visual idea: **the vessel**. A horizontal
fill bar where the filled length is literally the payout percentage,
nothing decorative added on top. Static in the hero (`VerdictBars.jsx`,
the five real verdict bands at their real widths), live on every task
card everywhere else.

Amber (`--earned`) is money that reached an agent. Slate (`--returned`) is
money that went back to the buyer. Every wei ends in exactly one of those
two places, so the two colours are the ledger's conservation law, not
decoration, and neither is used for anything else on the page. No
green/red anywhere: this product exists specifically to reject pass/fail,
so a verdict is a fill level and a word, never a status colour.

## The three tabs

- **Home**, hero, why-it's-different, how-it-works, a Contract card
  (address, network, explorer link, copy). Nothing here touches chain.
- **Job**, the public board, sourced from `list_roots`, every task on
  the protocol grouped into Open (unclaimed), In progress, and Settled
  (resolved or reclaimed, both terminal). Posting and hand-off happen
  here. Clicking any card scrolls to a detail panel below the board
  (`Panel.jsx` + `Cascade.jsx`) showing that job's full tree, live.
- **Dashboard**, strictly personal: only jobs where the connected
  wallet is buyer or agent somewhere in the tree. A real breakdown
  (settled/pending counts, GEN escrowed as buyer vs returned, GEN earned
  as an agent, tracked separately, not conflated), a banner when a job's
  waiting on you specifically to resolve it, and an "Edit profile" panel
  for username and skill tags.

## Contract reference

Writes:

```
create_root_task(spec, agent, tags) -> str      payable. agent="" means open, anyone can claim
propose_subcontract(parent_id, spec, agent, amount, tags) -> str   inert proposal; amount is a STRING (wei)
approve_subcontract(proposal_id)                root buyer only; activates the exact stored terms
claim_task(task_id)                             only works if agent==""
submit_deliverable(task_id, urls, evidence_commitment)   max 3 URLs plus SHA-256 commitment
resolve_task(task_id)                           buyer's normal settlement path
settle_after_timeout(task_id)                   permissionless at/after the stored deadline
withdraw_deliverable(task_id)                   agent only, while submitted
reclaim_task(task_id)                           buyer only, while posted, all children must be reclaimed (not resolved)
set_agent_tags(tags)
set_username(name)                              3-20 chars, alnum+underscore, case-insensitive unique, renameable, not removable
```

Views, all return JSON strings except the plain lookups:

```
list_roots() -> str            every root id, newest first
get_task(task_id) -> str
get_tree(root_id) -> str       whole subtree keyed by id, one call
get_agent_tags(address) -> str
get_username(address) -> str
get_address_by_username(name) -> str
```

## Shape

```
src/
  index.css                    design system, whole thing
  lib/gl.js                    genlayer-js wiring, contract address, wei/username helpers
  lib/tree.js                  get_tree JSON -> hierarchy + ledger math
  lib/tags.js                  the one shared skill-tag list
  lib/jobIndex.js              localStorage fallback job list, used only if list_roots is unavailable
  hooks/useNotifications.js    polls personal jobs, diffs status, generates real messages
  components/
    Panel.jsx                  dashboard chrome for the live detail view (title, live badge, address, copy)
    Cascade.jsx                the tree as connected cards, the Vessel component, task actions
    JobBoard.jsx                public board: every task, grouped, walks full trees not just roots
    JobCard.jsx                one task node's card, role-aware (buyer vs agent framing)
    Dashboard.jsx               personal view, stats, resolution banner, profile summary
    ProfileSettings.jsx         username + tags edit modal
    TagPicker.jsx                shared click-to-toggle chip picker
    DeliverablePreview.jsx      fetches and renders actual deliverable content, graceful CORS fallback
    Onboarding.jsx               first-connect intro modal
    NotificationBell.jsx         the bell dropdown
    TxProgress.jsx                transaction phase modal
    Reveal.jsx                   scroll-triggered fade-in wrapper
    VerdictBars.jsx               hero illustration
    Icons.jsx                     stroke icon set
  App.jsx                       tabs, wallet, every write function
```

## Things that will bite you if you edit this

1. **`amount` and `urls` are strings, addresses are lowercase strings.**
   Wei is ~1e18, past JavaScript's safe integer range, a number arrives
   mangled, usually as `1`. Use `genToWeiString()`. `BigInt()` throws on
   a float, hence the round inside it.
2. **`writeContract` resolves to the transaction hash, never the
   contract's return value.** Confirmed against GenLayer's own docs.
   To learn a newly created task's id, read `list_roots()` afterward
   (newest-first, shape fully known) rather than trying to parse the
   receipt.
3. **Reads need `transactionHashVariant: 'latest-nonfinal'`.** Without
   it you read finalized state, which lags 30-40 minutes behind reality.
4. **JSX does not process `\uXXXX` escapes** in raw text nodes or
   double-quoted attribute strings, only inside real JS string literals
   inside `{}`. This exact bug shipped at least four separate times
   across this build. Use the real character, always, everywhere it
   isn't already inside quotes.
5. **`resolve_task` and `reclaim_task` accept different child states.**
   Resolve accepts children that are `resolved` OR `reclaimed`. Reclaim
   requires every child to specifically be `reclaimed`. Reusing one
   check for the other button gate is a real bug that shipped once.
6. **A card that's a whole clickable `<button>` cannot contain its own
   `<a href>` inside** (invalid HTML, inconsistent click behavior across
   browsers). `JobCard` is a `div` with `role="button"` for exactly this
   reason, since `DeliverablePreview` renders real links inside it.
7. **The transaction phase modal's granular step tracking is unverified.**
   It polls `client.getTransaction({hash}).status` and hopes the value
   matches GenLayer's documented `TransactionStatus` enum
   (`PENDING/PROPOSING/COMMITTING/REVEALING/ACCEPTED`). Never confirmed
   live. The modal always shows a moving indeterminate bar regardless,
   pure CSS, no data dependency, so it can't look frozen even if the
   granular tracking turns out not to work. Console logs the raw poll
   response (`[cascade tx poll]`) for whoever tests this next.

## Steward security model

### Buyer-approved delegation

`propose_subcontract` stores the parent id, subcontractor, spec, wei amount,
and tags in a child record with status `proposed`. It is visible in `get_tree`,
but it is not an active child, does not reduce the parent's allocation, and
cannot be claimed or worked as an active task.

Only the root buyer can call `approve_subcontract`. Approval rechecks the
parent state and allocation, then activates the exact stored record without
accepting replacement terms. Recursive proposals follow the parent chain to
the same root-buyer authority.

### Non-ruggable timeout settlement

Submission stores the deterministic GenVM transaction timestamp as
`submitted_at` and fixes `resolution_deadline` seven days later. The buyer can
call `resolve_task` normally. At or after the deadline, any account can call
`settle_after_timeout`; the contract enforces both the deadline and submitted
state.

Both entry points use one private settlement routine. It makes exactly one
`gl.eq_principle.strict_eq` call and preserves the five graduated bands:
`FULL 95`, `MINOR_GAPS 80`, `PARTIAL 55`, `TANGENTIAL 25`, `UNRELATED 5`.
Timeout never means automatic success or a 100% release, and a settled task
cannot settle twice.

### Immutable evidence commitment

Before submitting, the frontend fetches each URL in order, JSON-encodes the
ordered array of exact response bodies, UTF-8 encodes it, and commits its
SHA-256 digest. Settlement refetches every body and recomputes the digest
inside the single strict-equivalence grading call. A fetch failure or mismatch
leaves the task submitted, unpaid, and unresolved; changed content is never
silently graded.

This binds content rather than trusting URL identity. It does not make the
host durable, so stable, publicly fetchable URLs are still required.

## Executable tests

The focused suite uses `genlayer-test` direct execution, public contract
methods, deterministic time warping, mocked web responses, and mocked jury
bands:

```powershell
$env:PYTHONUTF8='1'
py -m pytest tests/test_steward_integration.py -v
```

It covers proposal authorization and immutability, recursive root approval,
timestamps and deadlines, early-timeout rejection, permissionless graduated
timeout settlement, timeout-first race rejection, duplicate approval without a
second allocation deduction, pre-approval submission rejection, matching and
reordered multi-URL evidence, unavailable-host failure, duplicate-settlement
rejection, and all five payout bands without payment or resolution on failure.
The direct VM does not model the cross-contract `EthSend` used by
`emit_transfer`, so balance effects require glsim or a live-network test; this
suite asserts realized values and escrow accounting instead.

## Known, on purpose

- **Timeout eligibility uses GenVM transaction time.** It is deterministic
  consensus input for relative deadlines, not validator wall-clock time and
  not an external web oracle.
- **Skill tags and usernames are both self-declared and unverified,
  on purpose.** They're discovery aids for the open board, not
  credentials. An unqualified claim already gets punished by the jury
  with a low score and a small realized payout; gating on top of that
  would need real verification to mean anything, which is a separate,
  bigger, deliberately unbuilt decision.
- **Timeouts hit roughly a third of `resolve_task` calls on Bradbury.**
  Leader missing its execution window, not a contract bug. Nothing
  writes on failure, the task stays `submitted`, retrying is always
  safe and is the designed answer.
- **The jury reads a bounded excerpt of each deliverable**, split across
  however many URLs are submitted (up to 3), so the total budget stays
  roughly constant regardless of count. Focused
  artifacts grade reliably; a thousand-line file gets sampled, with an
  explicit note in the prompt telling the jury not to penalize that.
- **`DeliverablePreview` only renders content from sources that allow
  cross-origin reads.** Confirmed via a real header check that
  `raw.githubusercontent.com` does. Most ordinary web pages don't set
  that header; those fall back to a plain link instead of breaking.
- **Wallet disconnect is app-level only.** MetaMask has no API for a
  site to force a real disconnect. Reconnecting will be instant unless
  the site's access is revoked from inside MetaMask itself.
- **RainbowKit was evaluated and held, not built.** GenLayer's own docs
  show external-wallet integration via a bare address string, no
  provider object, pointing at `window.ethereum`-specific integration.
  RainbowKit's main value, WalletConnect and mobile wallets, is not
  `window.ethereum`. Unverified either way, not wired in without being
  able to check it actually works.
- **Open marketplace claiming has no self-claim guard.** A buyer can
  currently claim their own posted job. Not exploitable, it's their own
  escrow and the jury still grades honestly, but it was never a
  deliberate decision, just an unaddressed edge case.

## The grading mechanism

Validators previously only checked that a verdict was well-formed
(`LABEL||reason`, right shape), never whether the label itself was
actually justified, a real, reviewer-flagged weakness. The verdict is now
decided by `gl.eq_principle.strict_eq` over a single constrained word,
every validator independently fetches the evidence, independently judges
it, and must land on the byte-identical answer for the transaction to
commit. That's genuine independent verification, not a format check.

Free text will never come back byte-identical across independent models
even when they agree on substance, so the reasoning was split into its
own separate call, `explain_task`, which runs automatically right after
`resolve_task` succeeds (chained client-side, two transactions, one user
action). It moves no money and changes no stored score, generating the
explanation for an already-decided verdict. If that second call fails,
the verdict and payout are already final and unaffected, a "Get the
reasoning" fallback action appears on the task if `reasoning` is empty.

The steward changes preserve this mechanism. Their live Bradbury verification
and the local executable coverage are documented above.

## Messaging, real transactions, not a chat replacement

`send_message` / `get_messages`, gated to just the buyer and agent on a
given task. Plain storage, no AI, no consensus call, this doesn't touch
the thing that makes GenLayer worth building on, it's a cheap
clarification channel for a real, recurring need: asking a question
about scope before or after work is submitted. Every message is a real
transaction, gas cost per line, permanently public, no edits or deletes,
worth knowing before this gets used as general chat.

## Restructured into three real tabs
