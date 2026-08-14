# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
import json
import hashlib
from datetime import datetime, timezone
from genlayer import *


@gl.evm.contract_interface
class _Recipient:
    class View:
        pass

    class Write:
        pass


class AgenticCommerce(gl.Contract):

    RESOLUTION_WINDOW_SECONDS = 7 * 24 * 60 * 60

    task_counter: u64
    tasks:        TreeMap[str, str]   # JSON-encoded task dict
    root_buyer:   TreeMap[str, str]   # root task_id -> buyer address
    unspent_pool: TreeMap[str, str]   # root task_id -> str(int) shortfall accumulator
    root_ids:     DynArray[str]       # every root task_id ever created, in order
    agent_tags:   TreeMap[str, str]   # address -> comma-separated self-declared tags
    usernames:      TreeMap[str, str] # address -> claimed username
    username_index: TreeMap[str, str] # lowercased username -> address
    message_counts: TreeMap[str, str] # task_id -> str(int) number of messages on that task
    messages:       TreeMap[str, str] # "task_id:index" -> JSON {sender, text}

    def __init__(self):
        self.task_counter = u64(0)

    # ── Helpers ──────────────────────────────────────────────

    def _addr(self) -> str:
        return str(gl.message.sender_address).lower().strip()

    def _get_task(self, task_id: str) -> dict:
        raw = self.tasks.get(task_id, None)
        if raw is None:
            raise gl.vm.UserError("Task " + task_id + " does not exist")
        return json.loads(raw)

    def _save_task(self, task_id: str, t: dict):
        self.tasks[task_id] = json.dumps(t)

    def _find_root(self, task_id: str) -> str:
        current = task_id
        t = self._get_task(current)
        while t["parent_id"] != "":
            current = t["parent_id"]
            t = self._get_task(current)
        return current

    def _now(self) -> int:
        return int(datetime.now(timezone.utc).timestamp())

    # ── Creation ─────────────────────────────────────────────
    #
    # agent may be "" at creation. An empty agent means the task is open:
    # anyone can call claim_task to become its agent. Every guard that
    # checks "sender == task['agent']" already rejects everyone correctly
    # while agent is "", since no real address equals an empty string, so
    # nothing else needed to change to make an unclaimed task unusable
    # until claimed.

    @gl.public.write.payable
    def create_root_task(self, spec: str, agent: str, tags: str) -> str:
        payout = int(gl.message.value)
        if payout == 0:
            raise gl.vm.UserError("No GEN sent")

        task_id = str(int(self.task_counter))
        self.task_counter = u64(int(self.task_counter) + 1)
        buyer = self._addr()

        t = {
            "parent_id":        "",
            "buyer":             buyer,
            "agent":             agent.lower().strip(),
            "spec":              spec,
            "tags":              tags.strip(),
            "payout_allocated":  payout,
            "self_allocated":    payout,
            "children":          [],
            "delegation_proposals": [],
            "deliverable_url":   "",
            "evidence_commitment": "",
            "submitted_at":      0,
            "resolution_deadline": 0,
            "status":            "posted",
            "score":             -1,
            "band":              "",
            "realized":          -1,
            "fetched":           False,
            "reasoning":         "",
        }
        self._save_task(task_id, t)
        self.root_buyer[task_id]   = buyer
        self.unspent_pool[task_id] = "0"
        self.root_ids.append(task_id)
        return task_id

    @gl.public.write
    def propose_subcontract(self, parent_id: str, spec: str, agent: str, amount: str, tags: str) -> str:
        # amount is a STRING, not an int. Wei values are ~1e18, past JavaScript's
        # safe integer limit (~9e15), so a client sending an int param mangles
        # it. This bit three separate tree tests: 1000000000000000000 arrived as
        # 1, the child got one wei, its payout floored to zero, and the run
        # looked plausible while proving nothing. Payable `value` is unaffected
        # because it travels a different path.
        try:
            amt = int(str(amount).strip())
        except:
            raise gl.vm.UserError("amount must be a whole number of wei, sent as a string")
        if amt <= 0:
            raise gl.vm.UserError("amount must be greater than zero")

        parent = self._get_task(parent_id)
        if self._addr() != parent["agent"]:
            raise gl.vm.UserError("not the agent for this task")
        if parent["status"] != "posted":
            raise gl.vm.UserError("parent task is " + parent["status"] + ", cannot propose delegation")
        if amt > parent["self_allocated"]:
            raise gl.vm.UserError("exceeds unallocated balance")

        proposed_agent = agent.lower().strip()
        if not proposed_agent:
            raise gl.vm.UserError("proposed subcontractor is required")

        child_id = str(int(self.task_counter))
        self.task_counter = u64(int(self.task_counter) + 1)

        # A proposal is visible but economically inert until the root buyer
        # approves these exact stored terms.
        parent["delegation_proposals"].append(child_id)
        self._save_task(parent_id, parent)

        child = {
            "parent_id":        parent_id,
            "buyer":             parent["buyer"],
            "agent":             proposed_agent,
            "spec":              spec,
            "tags":              tags.strip(),
            "payout_allocated":  amt,
            "self_allocated":    amt,
            "children":          [],
            "delegation_proposals": [],
            "deliverable_url":   "",
            "evidence_commitment": "",
            "submitted_at":      0,
            "resolution_deadline": 0,
            "status":            "proposed",
            "score":             -1,
            "band":              "",
            "realized":          -1,
            "fetched":           False,
            "reasoning":         "",
        }
        self._save_task(child_id, child)
        return child_id

    @gl.public.write
    def approve_subcontract(self, proposal_id: str):
        child = self._get_task(proposal_id)
        if child["status"] != "proposed":
            raise gl.vm.UserError("delegation proposal is " + child["status"])

        parent_id = child["parent_id"]
        if not parent_id:
            raise gl.vm.UserError("root tasks are not delegation proposals")
        root_id = self._find_root(parent_id)
        if self._addr() != self.root_buyer[root_id]:
            raise gl.vm.UserError("only the root buyer can approve delegation")

        parent = self._get_task(parent_id)
        if parent["status"] != "posted":
            raise gl.vm.UserError("parent task is " + parent["status"] + ", cannot approve delegation")
        amount = int(child["payout_allocated"])
        if amount > int(parent["self_allocated"]):
            raise gl.vm.UserError("parent no longer has enough unallocated balance")

        parent["self_allocated"] -= amount
        parent["delegation_proposals"] = [
            pid for pid in parent["delegation_proposals"] if pid != proposal_id
        ]
        parent["children"].append(proposal_id)
        self._save_task(parent_id, parent)
        child["status"] = "posted"
        self._save_task(proposal_id, child)

    @gl.public.write
    def claim_task(self, task_id: str):
        task = self._get_task(task_id)
        if task["agent"] != "":
            raise gl.vm.UserError("this task is already assigned")
        if task["status"] != "posted":
            raise gl.vm.UserError("task is " + task["status"] + ", cannot claim")
        task["agent"] = self._addr()
        self._save_task(task_id, task)

    @gl.public.write
    def set_agent_tags(self, tags: str):
        # Self-declared, not verified, not enforced anywhere. This is a
        # discovery aid for filtering the open-job board, not a
        # credential. A jury already punishes an unqualified claim with a
        # low score and a small realized payout; tags don't gate anything
        # on top of that.
        self.agent_tags[self._addr()] = tags.strip()

    @gl.public.write
    def set_username(self, name: str):
        # Mirrors the proven pattern already live on GenMarkets exactly,
        # not a new design: same length bound, same charset, same
        # case-insensitive uniqueness, same safe-rename cleanup.
        name = name.strip()
        if len(name) < 3 or len(name) > 20:
            raise gl.vm.UserError("Username must be 3-20 characters")
        for ch in name:
            if not (ch.isalnum() or ch == "_"):
                raise gl.vm.UserError("Letters, numbers, underscores only")
        addr     = self._addr()
        key      = name.lower()
        existing = self.username_index.get(key, None)
        if existing and existing != addr:
            raise gl.vm.UserError("Username taken")
        old = self.usernames.get(addr, "")
        if old:
            try:
                del self.username_index[old.lower()]
            except:
                pass
        self.usernames[addr]     = name
        self.username_index[key] = addr

    # ── Delivery ─────────────────────────────────────────────

    @gl.public.write
    def submit_deliverable(self, task_id: str, urls: str, evidence_commitment: str):
        task = self._get_task(task_id)
        if self._addr() != task["agent"]:
            raise gl.vm.UserError("not the agent for this task")
        if task["status"] != "posted":
            raise gl.vm.UserError(
                "task is " + task["status"] + ", cannot submit deliverable"
            )
        url_list = [u.strip() for u in urls.split(",") if u.strip()]
        if not url_list:
            raise gl.vm.UserError("provide at least one deliverable URL")
        if len(url_list) > 3:
            raise gl.vm.UserError("at most 3 deliverable URLs per submission")
        commitment = evidence_commitment.lower().strip()
        if len(commitment) != 64:
            raise gl.vm.UserError("evidence commitment must be a SHA-256 hex digest")
        for ch in commitment:
            if ch not in "0123456789abcdef":
                raise gl.vm.UserError("evidence commitment must be a SHA-256 hex digest")

        submitted_at = self._now()
        task["deliverable_url"]     = ",".join(url_list)
        task["evidence_commitment"] = commitment
        task["submitted_at"]        = submitted_at
        task["resolution_deadline"] = submitted_at + self.RESOLUTION_WINDOW_SECONDS
        task["status"]              = "submitted"
        self._save_task(task_id, task)

    # ── Resolution ───────────────────────────────────────────

    @gl.public.write
    def resolve_task(self, task_id: str):
        task = self._get_task(task_id)
        if self._addr() != task["buyer"]:
            raise gl.vm.UserError("only the buyer can ask the jury to resolve this task")
        self._settle_task(task_id, task)

    @gl.public.write
    def settle_after_timeout(self, task_id: str):
        task = self._get_task(task_id)
        if task["status"] != "submitted":
            raise gl.vm.UserError("deliverable not submitted or task already settled")
        if self._now() < int(task["resolution_deadline"]):
            raise gl.vm.UserError("resolution deadline has not passed")
        self._settle_task(task_id, task)

    def _settle_task(self, task_id: str, task: dict):
        if task["status"] != "submitted":
            raise gl.vm.UserError("deliverable not submitted yet")
        for child_id in task["children"]:
            child = self._get_task(child_id)
            if child["status"] not in ("resolved", "reclaimed"):
                raise gl.vm.UserError("subcontract " + child_id + " is still " + child["status"])

        spec           = task["spec"]
        url_list       = [u.strip() for u in task["deliverable_url"].split(",") if u.strip()]
        commitment     = task["evidence_commitment"]
        agent_addr     = task["agent"]
        self_allocated = task["self_allocated"]

        def judge() -> str:
            # The ENTIRE body is wrapped. Any unhandled exception in a nondet
            # block becomes exit(1), which surfaces as "Execution Error /
            # exit_code 1" with no indication of what threw. Returning the
            # exception text instead turns a dead end into a readable message
            # on the explorer.
            try:
                def fetch_one(u):
                    # Plain HTTP, not web.render. render() boots a full browser
                    # to rasterize a page, pure overhead for a raw text file,
                    # and puts a browser launch inside the same execution
                    # window the leader has to beat.
                    try:
                        resp = gl.nondet.web.request(u, method="GET")
                    except:
                        return None, "could not be fetched"

                    # Field names differ between SDK versions. The docs
                    # describe `main` (status_code / body), but the Depends
                    # header pins an older runtime whose Response confirmed
                    # has no .status_code. Probe rather than assume.
                    st = 200
                    for name in ("status_code", "status", "code"):
                        if hasattr(resp, name):
                            try:
                                st = int(getattr(resp, name))
                            except:
                                pass
                            break
                    if st != 200:
                        return None, "returned HTTP " + str(st)

                    raw_body = None
                    for name in ("body", "text", "content", "data"):
                        if hasattr(resp, name):
                            raw_body = getattr(resp, name)
                            break
                    if raw_body is None:
                        return None, "response had no readable body"

                    full = raw_body.decode("utf-8") if isinstance(raw_body, bytes) else str(raw_body)
                    if not full.strip():
                        return None, "returned no content"
                    return full, None

                n = len(url_list)
                # Total content budget stays roughly constant regardless of
                # how many deliverables are submitted, one big prompt with
                # three concatenated files is exactly the shape that pushed
                # an earlier version over a leader timeout window.
                per_file_budget = max(1500, 8000 // max(1, n))

                sections = []
                full_contents = []
                for i in range(n):
                    u = url_list[i]
                    full, err = fetch_one(u)
                    if full is None:
                        return "EVIDENCE_FETCH_FAILED"
                    else:
                        full_contents.append(full)
                        note = ""
                        if len(full) > per_file_budget:
                            note = (
                                " [truncated for length here, judge only this excerpt, "
                                "do not penalize it for seeming incomplete]"
                            )
                        sections.append(
                            "--- deliverable " + str(i + 1) + " (" + u + ")" + note + " ---\n"
                            + full[:per_file_budget] + "\n"
                        )

                actual_commitment = hashlib.sha256(
                    json.dumps(
                        full_contents,
                        ensure_ascii=False,
                        separators=(",", ":"),
                    ).encode("utf-8")
                ).hexdigest()
                if actual_commitment != commitment:
                    return "EVIDENCE_MISMATCH"

                content = "\n".join(sections)

                # Constrained to a single word on purpose. This is the fix
                # for validators only checking output format instead of the
                # actual outcome: strict_eq requires every validator to
                # independently fetch the evidence, independently judge it,
                # and land on the byte-identical answer, real verification,
                # not a format check on a leader's claim. That only works
                # reliably against a tiny output space, which is why the
                # explanation is generated separately, in explain_task, by
                # a different consensus mechanism entirely. Free text will
                # never come back identical across five different models
                # even when they substantively agree, so it can never be
                # the thing strict_eq is asked to check.
                prompt = (
                    "You are grading delivered work against an agreed spec. Be strict: "
                    "only award a higher band when the deliverable clearly demonstrates "
                    "it, not when it merely seems plausible. If you are genuinely unsure "
                    "between two bands, choose the LOWER one.\n\n"
                    "SPEC:\n" + spec + "\n\n"
                    "DELIVERED CONTENT (" + str(n) + " item(s), fetched live just now):\n"
                    + content + "\n\n"
                    "Before choosing a label, check each concrete requirement in the spec "
                    "against the delivered content. A requirement only counts as met if "
                    "you can point to something specific in the content that satisfies it. "
                    "A requirement you cannot find evidence for counts as unmet, not as "
                    "probably-fine. If a deliverable is an error page, a navigation menu, "
                    "or a table of contents rather than real work, treat it as not fetched "
                    "for that item.\n\n"
                    "FULL        : every concrete requirement in the spec is clearly met\n"
                    "MINOR_GAPS  : nearly all requirements met, only small or cosmetic gaps\n"
                    "PARTIAL     : some requirements clearly met, others clearly missing\n"
                    "TANGENTIAL  : loosely related, most requirements unmet\n"
                    "UNRELATED   : unrelated to the spec, or no usable content\n\n"
                    "Reply with EXACTLY one word and nothing else, no punctuation, no "
                    "explanation: FULL, MINOR_GAPS, PARTIAL, TANGENTIAL, or UNRELATED."
                )

                result = str(gl.nondet.exec_prompt(prompt)).strip().upper()
                for band in ("FULL", "MINOR_GAPS", "PARTIAL", "TANGENTIAL", "UNRELATED"):
                    if band == result or result.startswith(band):
                        return band
                return "GRADER_FAILED"

            except Exception:
                return "GRADER_FAILED"

        band = gl.eq_principle.strict_eq(judge)

        BANDS = {
            "FULL":       95,
            "MINOR_GAPS": 80,
            "PARTIAL":    55,
            "TANGENTIAL": 25,
            "UNRELATED":   5,
        }

        # Neither a dead link nor a broken grader is a verdict on the work.
        # Refusing to resolve leaves the task submitted so it can be retried,
        # rather than permanently zeroing an agent because a page was down.
        if band == "EVIDENCE_FETCH_FAILED":
            raise gl.vm.UserError(
                "Could not fetch one or more deliverables, task left submitted, retry resolve"
            )
        if band == "EVIDENCE_MISMATCH":
            raise gl.vm.UserError(
                "Evidence content does not match the submitted commitment; task left submitted"
            )
        if band not in BANDS:
            raise gl.vm.UserError(
                "Grader did not return a usable verdict, task left submitted, retry resolve"
            )

        fetched = True
        score   = BANDS[band]

        realized  = (self_allocated * score) // 100
        shortfall = self_allocated - realized

        if realized > 0:
            _Recipient(Address(agent_addr)).emit_transfer(value=realized)

        root_id = self._find_root(task_id)
        pool    = int(self.unspent_pool.get(root_id, "0"))
        self.unspent_pool[root_id] = str(pool + shortfall)

        task["score"]     = score
        task["band"]      = band
        task["status"]    = "resolved"
        task["fetched"]   = fetched
        task["realized"]  = realized
        self._save_task(task_id, task)

        if task["parent_id"] == "":
            buyer  = self.root_buyer[task_id]
            refund = int(self.unspent_pool.get(task_id, "0"))
            if refund > 0:
                _Recipient(Address(buyer)).emit_transfer(value=refund)
                self.unspent_pool[task_id] = "0"

    # ── Explanation ──────────────────────────────────────────
    #
    # Deliberately a second, separate transaction, not folded into
    # resolve_task above. Two eq_principle calls inside one function, even
    # sequential and non-nested, is not a pattern confirmed safe anywhere
    # in this codebase, and the one documented failure mode for stacking
    # consensus calls in a single execution path is a silent exit_code 1.
    # Splitting into two calls costs an extra transaction but is built
    # entirely on patterns already proven live.
    #
    # This moves no money and changes no stored score. It exists purely to
    # produce the human-readable reasoning, which is real product value,
    # just never the thing that needed independent verification. Anyone
    # can call it once a task is resolved, callable more than once if the
    # first explanation reads poorly, each call overwrites the last.

    @gl.public.write
    def explain_task(self, task_id: str):
        task = self._get_task(task_id)
        if task["status"] != "resolved":
            raise gl.vm.UserError("task is " + task["status"] + ", nothing to explain yet")

        spec       = task["spec"]
        url_list   = [u.strip() for u in task["deliverable_url"].split(",") if u.strip()]
        band       = task["band"]

        def judge() -> str:
            try:
                def fetch_one(u):
                    try:
                        resp = gl.nondet.web.request(u, method="GET")
                    except:
                        return None
                    raw_body = None
                    for name in ("body", "text", "content", "data"):
                        if hasattr(resp, name):
                            raw_body = getattr(resp, name)
                            break
                    if raw_body is None:
                        return None
                    full = raw_body.decode("utf-8") if isinstance(raw_body, bytes) else str(raw_body)
                    return full if full.strip() else None

                n = len(url_list)
                per_file_budget = max(1500, 8000 // max(1, n))
                sections = []
                for i in range(n):
                    full = fetch_one(url_list[i])
                    if full:
                        sections.append(full[:per_file_budget])
                content = "\n\n".join(sections) if sections else "(deliverable could not be re-fetched)"

                prompt = (
                    "A piece of delivered work was already graded against a spec, and the "
                    "verdict was " + band + ". Your only job is to explain, in one short "
                    "sentence, why this specific deliverable earned that specific verdict. "
                    "Cite something concrete from the content below. Do not propose a "
                    "different verdict, the grading is already final.\n\n"
                    "SPEC:\n" + spec + "\n\n"
                    "VERDICT ALREADY GIVEN: " + band + "\n\n"
                    "DELIVERED CONTENT:\n" + content + "\n\n"
                    "Reply with one sentence, nothing else."
                )
                text = str(gl.nondet.exec_prompt(prompt)).strip()[:400]
                return text if text else "No reasoning could be generated."
            except Exception:
                return "No reasoning could be generated."

        # Free text, checked only for being present and reasonably short.
        # This is exactly the kind of open-ended content prompt_non_comparative
        # was meant for, format-only agreement is the correct bar here
        # because nothing downstream depends on the wording matching
        # exactly, unlike the verdict itself above.
        explanation = gl.eq_principle.prompt_non_comparative(
            judge,
            task=(
                "A grader wrote one sentence explaining an already-decided verdict on a "
                "piece of work. You are only checking that a real sentence was returned, "
                "you cannot see the deliverable or the spec."
            ),
            criteria="Accept any non-empty text under 500 characters that is not just punctuation or whitespace.",
        )

        task["reasoning"] = str(explanation).strip()[:400]
        self._save_task(task_id, task)

    # ── Exits ────────────────────────────────────────────────
    #
    # Without these, a task whose resolve_task keeps failing locks its GEN in
    # the contract forever. That is not hypothetical: an earlier deploy stranded
    # 3 GEN in exactly this state, because the only way out was a resolve path
    # that had stopped working.
    #
    # Submitted work has a deterministic transaction-time deadline, so a
    # permissionless timeout settlement is available if the buyer never calls
    # resolve_task. The separate withdraw/reclaim exits still cover posted work:
    # an agent can withdraw an ungraded submission, and the buyer can reclaim
    # only once nothing is submitted. A submitted task stays escrowed until
    # either normal buyer resolution or the same grading path after timeout.

    @gl.public.write
    def withdraw_deliverable(self, task_id: str):
        task = self._get_task(task_id)
        if self._addr() != task["agent"]:
            raise gl.vm.UserError("not the agent for this task")
        if task["status"] != "submitted":
            raise gl.vm.UserError("nothing submitted to withdraw")
        task["status"]          = "posted"
        task["deliverable_url"] = ""
        task["evidence_commitment"] = ""
        task["submitted_at"] = 0
        task["resolution_deadline"] = 0
        self._save_task(task_id, task)

    @gl.public.write
    def reclaim_task(self, task_id: str):
        task = self._get_task(task_id)
        if self._addr() != task["buyer"]:
            raise gl.vm.UserError("not the buyer for this task")
        if task["status"] != "posted":
            raise gl.vm.UserError(
                "task is " + task["status"] + ", agent must withdraw their deliverable first"
            )
        for child_id in task["children"]:
            child = self._get_task(child_id)
            if child["status"] != "reclaimed":
                raise gl.vm.UserError("subcontract " + child_id + " must be reclaimed first")

        amount = task["self_allocated"]
        task["self_allocated"] = 0
        task["status"]         = "reclaimed"
        self._save_task(task_id, task)

        parent_id = task["parent_id"]
        if parent_id == "":
            # Root: hand the money back to the buyer, plus anything already
            # pooled from children that resolved below 100%.
            refund = amount + int(self.unspent_pool.get(task_id, "0"))
            self.unspent_pool[task_id] = "0"
            if refund > 0:
                _Recipient(Address(task["buyer"])).emit_transfer(value=refund)
        else:
            # Child: the money was carved out of the parent's allocation, so it
            # returns there rather than skipping the chain back to the buyer.
            parent = self._get_task(parent_id)
            parent["self_allocated"] += amount
            self._save_task(parent_id, parent)

    # ── Messages ─────────────────────────────────────────────
    #
    # Plain storage, no AI, no consensus call, deliberately. This doesn't
    # touch the thing that makes GenLayer worth building on, it's just a
    # cheap request-for-clarification channel between the two people
    # already party to a task. Gated to buyer/agent only, not open to
    # anyone, and every message is a real transaction: gas cost per line,
    # permanently public, no edits or deletes. Worth knowing before this
    # gets used as a general chat, it isn't Discord.

    @gl.public.write
    def send_message(self, task_id: str, text: str):
        task = self._get_task(task_id)
        sender = self._addr()
        if sender != task["buyer"] and sender != task["agent"]:
            raise gl.vm.UserError("only the buyer or agent for this task can send a message")
        clean = text.strip()
        if not clean:
            raise gl.vm.UserError("message cannot be empty")
        if len(clean) > 500:
            raise gl.vm.UserError("message must be 500 characters or fewer")

        count = int(self.message_counts.get(task_id, "0"))
        key = task_id + ":" + str(count)
        self.messages[key] = json.dumps({"sender": sender, "text": clean})
        self.message_counts[task_id] = str(count + 1)

    @gl.public.view
    def get_messages(self, task_id: str) -> str:
        count = int(self.message_counts.get(task_id, "0"))
        result = []
        for i in range(count):
            raw = self.messages.get(task_id + ":" + str(i), None)
            if raw:
                result.append(json.loads(raw))
        return json.dumps(result)

    # ── Views ────────────────────────────────────────────────

    @gl.public.view
    def list_roots(self) -> str:
        # Iterate by index, not direct iteration, matching the pattern
        # already proven live on GenMarkets' get_all_markets. Returns
        # newest first so a dashboard doesn't need to reverse it.
        total = len(self.root_ids)
        result = []
        for i in range(total):
            result.append(self.root_ids[total - 1 - i])
        return json.dumps(result)

    @gl.public.view
    def get_task(self, task_id: str) -> str:
        return json.dumps(self._get_task(task_id))

    @gl.public.view
    def get_tree(self, root_id: str) -> str:
        result = {}
        stack = [root_id]
        while stack:
            tid = stack.pop()
            t = self._get_task(tid)
            result[tid] = t
            stack.extend(t["children"])
            stack.extend(t.get("delegation_proposals", []))
        return json.dumps(result)

    @gl.public.view
    def get_agent_tags(self, address: str) -> str:
        return self.agent_tags.get(address.lower().strip(), "")

    @gl.public.view
    def get_username(self, address: str) -> str:
        return self.usernames.get(address.lower().strip(), "")

    @gl.public.view
    def get_address_by_username(self, name: str) -> str:
        return self.username_index.get(name.lower().strip(), "")
