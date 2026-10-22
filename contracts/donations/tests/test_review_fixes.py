"""Offline regressions for the two blocking independent-review findings."""
import pytest
from pytezos.michelson.micheline import MichelsonRuntimeError
from test_contract import ADMIN, DONOR, SELF, run, storage


@pytest.mark.parametrize('initial', [2**63 - 1, 2**63, 2**100 + 123])
@pytest.mark.parametrize('entry', ['donate', 'dispurse_donations'])
def test_lifetime_counters_are_unbounded_nat(initial, entry):
    s = dict(storage(), total_donated=initial, total_disbursed=initial)
    if entry == 'donate':
        r = run(entry, b'one mutez', s, amount=1, balance=1)
        assert r.storage == dict(s, total_donated=initial + 1,
            next_donation_id=1, donations={0: dict(sender=DONOR, amount=1,
                timestamp=1700000000, level=123, memo=b'one mutez')})
        assert r.operations == []
    else:
        r = run(entry, None, s, sender=ADMIN, balance=1)
        assert r.storage == dict(s, total_disbursed=initial + 1)
        assert len(r.operations) == 1
        assert r.operations[0]['amount'] == '1'
        assert r.operations[0]['destination'] == s['donation_recipient']



@pytest.mark.parametrize('recipient', [DONOR, 'KT1Xobej4mc6XgEjDoJoHtTKgbD1ELMvcQuL%receive'])
def test_external_unit_routing_still_allowed(recipient, protocol_address):
    r = run('Update_donation_routing', recipient, sender=ADMIN)
    assert r.storage == dict(storage(), donation_recipient=recipient)
    assert r.operations == []
    payout = run('dispurse_donations', None, r.storage, sender=ADMIN, balance=7)
    assert payout.storage == dict(r.storage, total_disbursed=7)
    assert len(payout.operations) == 1
    assert payout.operations[0]['amount'] == '7'
    assert payout.operations[0]['destination'] == recipient.split('%')[0]


def test_all_fields_preserved_through_populated_admin_transitions():
    from test_contract import BAKER
    s = storage()
    for amount, memo in [(2, b'first'), (5, 'é😀'.encode())]:
        s = run('donate', memo, s, amount=amount, balance=amount).storage
    s = dict(s, selected_baker=BAKER, total_disbursed=2**100)
    routed = run('Update_donation_routing', DONOR, s, sender=ADMIN)
    assert routed.storage == dict(s, donation_recipient=DONOR)
    assert routed.operations == []
    cleared = run('set_baker', None, routed.storage, sender=ADMIN)
    assert cleared.storage == dict(routed.storage, selected_baker=None)
    assert len(cleared.operations) == 1
    assert cleared.operations[0]['kind'] == 'delegation'
    assert cleared.operations[0].get('delegate') is None
    payout = run('dispurse_donations', None, cleared.storage, sender=ADMIN, balance=17)
    assert payout.storage == dict(cleared.storage, total_disbursed=2**100 + 17)
    assert len(payout.operations) == 1
    assert payout.operations[0]['amount'] == '17'
    assert payout.operations[0]['destination'] == DONOR


@pytest.fixture
def protocol_address(monkeypatch):
    """Correct PyTezos 3.20 ADDRESS dropping the contract's entrypoint.

    SELF constructs the right contract value, but ADDRESS calls get_address(),
    which strips its suffix. This scoped opcode correction preserves the full
    address as the protocol does; native confirmation remains parent-owned.
    """
    from pytezos.michelson.instructions.tezos import AddressInstruction
    from pytezos.michelson.types import AddressType, ContractType

    def execute(cls, stack, stdout, context):
        value = stack.pop1()
        value.assert_type_in(ContractType)
        result = AddressType.from_value(value.value)
        stack.push(result)
        stdout.append('ADDRESS (entrypoint-preserving emulator correction)')
        return cls(stack_items_added=1)

    monkeypatch.setattr(AddressInstruction, 'execute', classmethod(execute))


@pytest.mark.parametrize('suffix', ['', '%default', '%dispurse_donations'])
@pytest.mark.parametrize('preloaded', [False, True])
def test_self_recipient_alias_rejected(suffix, preloaded, protocol_address):
    recipient = SELF + suffix
    with pytest.raises(MichelsonRuntimeError, match='SELF_RECIPIENT'):
        if preloaded:
            run('dispurse_donations', None,
                dict(storage(), donation_recipient=recipient), sender=ADMIN, balance=1)
        else:
            run('Update_donation_routing', recipient, sender=ADMIN)
