import hashlib
import json
import os
from unittest.mock import patch

import pytest


# The direct VM exposes ``deal`` and balance reads, but does not implement the
# cross-contract EthSend operation used by ``_Recipient.emit_transfer``.  The
# payout assertions below therefore verify the contract's realized amount and
# escrow accounting only; recipient/buyer balance effects require glsim or a
# live-network integration test.


CONTRACT = "agentic_commerce.py"
BUYER_TIME = "2026-08-13T12:00:00Z"
SUBMITTED_AT = 1786622400
WINDOW = 7 * 24 * 60 * 60


def commitment_for(*contents):
    canonical = json.dumps(
        list(contents), ensure_ascii=False, separators=(",", ":")
    ).encode("utf-8")
    return hashlib.sha256(canonical).hexdigest()


def address_text(value):
    return "0x" + bytes(value).hex()


@pytest.fixture
def escrow(direct_vm, direct_deploy, direct_alice, direct_bob, direct_charlie):
    buyer = direct_alice
    parent_agent = direct_bob
    subcontractor = direct_charlie
    direct_vm.sender = buyer
    real_unlink = os.unlink

    def windows_safe_unlink(path, *args, **kwargs):
        try:
            return real_unlink(path, *args, **kwargs)
        except PermissionError:
            # genlayer-test 0.29.2 duplicates this temp file onto stdin and
            # then unlinks it before closing the duplicated Windows handle.
            # POSIX permits that; Windows does not. The VM closes it at fixture
            # teardown, so ignoring only this loader error is safe.
            return None

    with patch("os.unlink", side_effect=windows_safe_unlink):
        contract = direct_deploy(CONTRACT)
    direct_vm.value = 1_000
    contract.create_root_task("root spec", address_text(parent_agent), "python")
    direct_vm.value = 0
    return contract, direct_vm, buyer, parent_agent, subcontractor


def task(contract, task_id):
    return json.loads(contract.get_task(str(task_id)))


def propose(escrow, amount="300"):
    contract, vm, _, parent_agent, subcontractor = escrow
    vm.sender = parent_agent
    contract.propose_subcontract(
        "0", "exact child spec", address_text(subcontractor), amount, "audit,python"
    )
    return "1"


def submit_root(escrow, content="delivered evidence", committed_content=None):
    contract, vm, _, parent_agent, _ = escrow
    vm.sender = parent_agent
    vm.warp(BUYER_TIME)
    committed = content if committed_content is None else committed_content
    contract.submit_deliverable(
        "0", "https://example.test/deliverable", commitment_for(committed)
    )
    return content


def mock_grade(vm, content, band="PARTIAL"):
    vm.mock_web(r"example\.test/deliverable", {"status": 200, "body": content})
    vm.mock_llm(r"You are grading delivered work", band)


def submit_urls(escrow, urls, contents, committed_contents=None):
    contract, vm, _, parent_agent, _ = escrow
    vm.sender = parent_agent
    vm.warp(BUYER_TIME)
    committed = contents if committed_contents is None else committed_contents
    contract.submit_deliverable(
        "0", ",".join(urls), commitment_for(*committed)
    )


def mock_grade_urls(vm, urls, contents, band="PARTIAL"):
    for url, content in zip(urls, contents):
        vm.mock_web(
            url.replace("https://", "").replace("/", r"/"),
            {"status": 200, "body": content},
        )
    vm.mock_llm(r"You are grading delivered work", band)


def test_agent_cannot_activate_subcontract_without_buyer_approval(escrow):
    contract, _, _, _, _ = escrow
    proposal_id = propose(escrow)

    parent = task(contract, "0")
    child = task(contract, proposal_id)
    assert parent["self_allocated"] == 1_000
    assert parent["children"] == []
    assert parent["delegation_proposals"] == [proposal_id]
    assert child["status"] == "proposed"


def test_unapproved_subcontract_cannot_submit_or_enter_timeout_settlement(escrow):
    contract, vm, _, _, subcontractor = escrow
    proposal_id = propose(escrow)
    vm.sender = subcontractor

    with pytest.raises(Exception, match="task is proposed"):
        contract.submit_deliverable(
            proposal_id,
            "https://example.test/deliverable",
            commitment_for("unapproved evidence"),
        )

    child = task(contract, proposal_id)
    assert child["status"] == "proposed"
    assert child["realized"] == -1
    assert task(contract, "0")["self_allocated"] == 1_000

    vm.warp("2026-08-20T12:00:00Z")
    with pytest.raises(Exception, match="deliverable not submitted"):
        contract.settle_after_timeout(proposal_id)
    assert task(contract, proposal_id) == child


def test_unauthorized_account_cannot_approve_delegation(escrow):
    contract, vm, _, parent_agent, _ = escrow
    proposal_id = propose(escrow)
    vm.sender = parent_agent

    with pytest.raises(Exception, match="only the root buyer"):
        contract.approve_subcontract(proposal_id)

    assert task(contract, proposal_id)["status"] == "proposed"
    assert task(contract, "0")["self_allocated"] == 1_000


def test_buyer_approval_activates_exact_immutable_terms(escrow):
    contract, vm, buyer, _, subcontractor = escrow
    proposal_id = propose(escrow)
    proposed = task(contract, proposal_id)
    vm.sender = buyer
    contract.approve_subcontract(proposal_id)

    parent = task(contract, "0")
    approved = task(contract, proposal_id)
    assert parent["self_allocated"] == 700
    assert parent["children"] == [proposal_id]
    assert parent["delegation_proposals"] == []
    assert approved["status"] == "posted"
    for field in ("parent_id", "agent", "spec", "tags", "payout_allocated"):
        assert approved[field] == proposed[field]
    assert approved["agent"] == address_text(subcontractor)

    with pytest.raises(Exception, match="delegation proposal is posted"):
        contract.approve_subcontract(proposal_id)
    with pytest.raises(Exception, match="already assigned"):
        contract.claim_task(proposal_id)
    assert task(contract, proposal_id) == approved


def test_second_delegation_approval_cannot_deduct_allocation_again(escrow):
    contract, vm, buyer, _, _ = escrow
    proposal_id = propose(escrow, amount="300")

    vm.sender = buyer
    contract.approve_subcontract(proposal_id)
    remaining = task(contract, "0")["self_allocated"]

    with pytest.raises(Exception, match="delegation proposal is posted"):
        contract.approve_subcontract(proposal_id)

    assert task(contract, "0")["self_allocated"] == remaining


def test_recursive_subcontracting_still_requires_root_buyer_approval(escrow):
    contract, vm, buyer, _, subcontractor = escrow
    child_id = propose(escrow)
    vm.sender = buyer
    contract.approve_subcontract(child_id)

    vm.sender = subcontractor
    contract.propose_subcontract(
        child_id,
        "grandchild exact spec",
        "0x00000000000000000000000000000000000000aa",
        "100",
        "research",
    )
    grandchild_id = "2"
    vm.sender = subcontractor
    with pytest.raises(Exception, match="only the root buyer"):
        contract.approve_subcontract(grandchild_id)
    assert task(contract, grandchild_id)["status"] == "proposed"

    vm.sender = buyer
    contract.approve_subcontract(grandchild_id)
    assert task(contract, grandchild_id)["status"] == "posted"
    assert task(contract, child_id)["self_allocated"] == 200


def test_submission_timestamp_and_deadline_are_deterministic(escrow):
    contract, _, _, _, _ = escrow
    submit_root(escrow)

    root = task(contract, "0")
    assert root["submitted_at"] == SUBMITTED_AT
    assert root["resolution_deadline"] == SUBMITTED_AT + WINDOW
    assert root["evidence_commitment"] == commitment_for("delivered evidence")


def test_timeout_fails_before_deadline(escrow, direct_charlie):
    contract, vm, _, _, _ = escrow
    submit_root(escrow)
    vm.sender = direct_charlie
    vm.warp("2026-08-20T11:59:59Z")

    with pytest.raises(Exception, match="deadline has not passed"):
        contract.settle_after_timeout("0")
    assert task(contract, "0")["status"] == "submitted"


def test_timeout_is_permissionless_and_uses_graduated_jury_result(escrow, direct_charlie):
    contract, vm, _, _, _ = escrow
    content = submit_root(escrow)
    mock_grade(vm, content, "PARTIAL")
    vm.sender = direct_charlie
    vm.warp("2026-08-20T12:00:00Z")
    contract.settle_after_timeout("0")

    root = task(contract, "0")
    assert root["status"] == "resolved"
    assert root["band"] == "PARTIAL"
    assert root["score"] == 55
    assert root["realized"] == 550
    assert contract.unspent_pool["0"] == "0"


def test_timeout_first_blocks_buyer_resolution_and_second_payout(escrow, direct_charlie):
    contract, vm, buyer, _, _ = escrow
    content = submit_root(escrow, "timeout-first content")
    mock_grade(vm, content, "PARTIAL")

    vm.sender = direct_charlie
    vm.warp("2026-08-20T12:00:00Z")
    contract.settle_after_timeout("0")
    settled = task(contract, "0")
    pool_after_timeout = contract.unspent_pool["0"]

    vm.sender = buyer
    with pytest.raises(Exception, match="deliverable not submitted yet"):
        contract.resolve_task("0")

    assert task(contract, "0") == settled
    assert contract.unspent_pool["0"] == pool_after_timeout


def test_settlement_cannot_execute_twice(escrow, direct_charlie):
    contract, vm, buyer, _, _ = escrow
    content = submit_root(escrow)
    mock_grade(vm, content, "MINOR_GAPS")
    vm.sender = buyer
    contract.resolve_task("0")

    vm.sender = direct_charlie
    vm.warp("2026-08-21T12:00:00Z")
    with pytest.raises(Exception, match="already settled"):
        contract.settle_after_timeout("0")
    assert task(contract, "0")["realized"] == 800


def test_matching_evidence_commitment_can_be_graded(escrow):
    contract, vm, buyer, _, _ = escrow
    content = submit_root(escrow, "immutable payload")
    mock_grade(vm, content, "FULL")
    vm.sender = buyer
    contract.resolve_task("0")

    root = task(contract, "0")
    assert root["fetched"] is True
    assert root["band"] == "FULL"
    assert root["realized"] == 950
    assert contract.unspent_pool["0"] == "0"


def test_multiple_ordered_evidence_urls_settle_with_matching_commitment(escrow):
    contract, vm, buyer, _, _ = escrow
    urls = [
        "https://example.test/first",
        "https://example.test/second",
    ]
    contents = ["first evidence", "second evidence"]
    submit_urls(escrow, urls, contents)
    mock_grade_urls(vm, urls, contents, "FULL")

    vm.sender = buyer
    contract.resolve_task("0")

    root = task(contract, "0")
    assert root["status"] == "resolved"
    assert root["fetched"] is True
    assert root["realized"] == 950


def test_reordered_evidence_urls_fail_ordered_commitment(escrow):
    contract, vm, buyer, _, _ = escrow
    urls = [
        "https://example.test/second",
        "https://example.test/first",
    ]
    original_contents = ["first evidence", "second evidence"]
    actual_contents = ["second evidence", "first evidence"]
    submit_urls(escrow, urls, actual_contents, committed_contents=original_contents)
    mock_grade_urls(vm, urls, actual_contents, "FULL")

    before = task(contract, "0")
    vm.sender = buyer
    with pytest.raises(Exception, match="does not match the submitted commitment"):
        contract.resolve_task("0")

    assert task(contract, "0") == before
    assert contract.unspent_pool["0"] == "0"


def test_unavailable_evidence_fails_without_payment_resolution_or_accounting_change(escrow):
    contract, vm, buyer, _, _ = escrow
    submit_root(escrow, "evidence that later goes offline")
    vm.mock_web(
        r"example\.test/deliverable",
        {"status": 503, "body": "temporarily unavailable"},
    )

    before = task(contract, "0")
    pool_before = contract.unspent_pool["0"]
    vm.sender = buyer
    with pytest.raises(Exception, match="Could not fetch one or more deliverables"):
        contract.resolve_task("0")

    assert task(contract, "0") == before
    assert contract.unspent_pool["0"] == pool_before


@pytest.mark.parametrize(
    ("band", "score"),
    [
        ("FULL", 95),
        ("MINOR_GAPS", 80),
        ("PARTIAL", 55),
        ("TANGENTIAL", 25),
        ("UNRELATED", 5),
    ],
)
def test_all_payout_bands_calculate_realized_amount(escrow, band, score):
    contract, vm, buyer, _, _ = escrow
    content = submit_root(escrow, "band test content")
    mock_grade(vm, content, band)
    vm.sender = buyer
    contract.resolve_task("0")

    root = task(contract, "0")
    assert root["band"] == band
    assert root["score"] == score
    assert root["realized"] == (1_000 * score) // 100
    # Root settlement consumes the shortfall into the buyer refund transfer;
    # direct mode cannot expose that transfer's recipient balance.
    assert contract.unspent_pool["0"] == "0"


def test_changed_evidence_fails_without_payment_or_resolution(escrow):
    contract, vm, buyer, _, _ = escrow
    changed = submit_root(
        escrow,
        content="changed after submission",
        committed_content="original at submission",
    )
    mock_grade(vm, changed, "FULL")
    vm.sender = buyer

    with pytest.raises(Exception, match="does not match the submitted commitment"):
        contract.resolve_task("0")

    root = task(contract, "0")
    assert root["status"] == "submitted"
    assert root["score"] == -1
    assert root["realized"] == -1
    assert root["fetched"] is False
    assert int(contract.unspent_pool["0"]) == 0
