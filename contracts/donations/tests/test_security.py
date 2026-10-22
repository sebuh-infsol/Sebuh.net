"""Security and state transitions; all fixtures are public, no RPC/signers."""
import pytest
from pytezos.michelson.micheline import MichelsonRuntimeError
from test_contract import ADMIN, DONOR, RECIPIENT, SELF, BAKER, run, storage

ADMIN_CALLS = [('Update_donation_routing', DONOR), ('dispurse_donations', None), ('set_baker', BAKER)]

@pytest.mark.parametrize('entry,value', ADMIN_CALLS)
@pytest.mark.parametrize('source', [ADMIN, DONOR])
def test_nonadmin_even_when_source_admin(entry, value, source):
    with pytest.raises(MichelsonRuntimeError, match='NOT_ADMIN'):
        run(entry, value, source=source, sender=DONOR, balance=500)

@pytest.mark.parametrize('entry,value', ADMIN_CALLS)
def test_admin_extra_xtz_rejected(entry, value):
    with pytest.raises(MichelsonRuntimeError, match='ADMIN_AMOUNT'):
        run(entry, value, sender=ADMIN, amount=1, balance=500)

@pytest.mark.parametrize('entry,value', ADMIN_CALLS)
def test_sender_admin_source_other_accepted(entry, value):
    run(entry, value, sender=ADMIN, source=DONOR, balance=500)

def test_zero_donation():
    with pytest.raises(MichelsonRuntimeError, match='ZERO_DONATION'):
        run('donate', b'')

def test_self_routing():
    with pytest.raises(MichelsonRuntimeError, match='SELF_RECIPIENT'):
        run('Update_donation_routing', SELF, sender=ADMIN)

def test_zero_balance():
    with pytest.raises(MichelsonRuntimeError, match='ZERO_BALANCE'):
        run('dispurse_donations', None, sender=ADMIN)

def test_stored_self_recipient_defense():
    s = dict(storage(), donation_recipient=SELF)
    with pytest.raises(MichelsonRuntimeError, match='SELF_RECIPIENT'):
        run('dispurse_donations', None, s, sender=ADMIN, balance=1)

def test_delegate_none():
    s = dict(storage(), selected_baker=BAKER)
    r = run('set_baker', None, s, sender=ADMIN, balance=100)
    assert r.storage == storage()
    assert len(r.operations) == 1
    assert r.operations[0]['kind'] == 'delegation'
    assert r.operations[0].get('delegate') is None

def test_chronological_history_survives_all_admin_actions():
    s = storage()
    for i, memo in enumerate([b'first', 'é😀\n'.encode(), b'', b'last']):
        r = run('donate', memo, s, amount=i+1, balance=50+i,
                now=1700000000+i, level=123+i, source=ADMIN)
        s = r.storage
        assert r.operations == []
        assert sorted(s['donations']) == list(range(i+1))
        assert s['donations'][i] == dict(sender=DONOR, amount=i+1,
            memo=memo, timestamp=1700000000+i, level=123+i)
    history = dict(s['donations'])
    r = run('set_baker', BAKER, s, sender=ADMIN, balance=88)
    s = r.storage
    assert s['donations'] == history
    s = run('Update_donation_routing', DONOR, s, sender=ADMIN).storage
    assert s['selected_baker'] == BAKER
    r = run('dispurse_donations', None, s, sender=ADMIN, balance=88)
    assert r.operations[0]['destination'] == DONOR
    assert r.operations[0]['amount'] == '88'
    assert r.storage['total_donated'] == 10
    assert r.storage['total_disbursed'] == 88
    assert r.storage['selected_baker'] == BAKER
    assert r.storage['next_donation_id'] == 4
    assert r.storage['donations'] == history
    r2 = run('dispurse_donations', None, r.storage, sender=ADMIN, balance=22)
    assert r2.storage['total_disbursed'] == 110
    assert r2.storage['total_donated'] == 10
    assert r2.storage['donations'] == history


def test_failed_calls_preserve_caller_history_fixture():
    from copy import deepcopy
    s = run('donate', b'preserve', amount=13, balance=13).storage
    before = deepcopy(s)
    failures = [('donate', b'\xff', dict(amount=1, balance=14)),
                ('donate', b'', {}),
                ('Update_donation_routing', SELF, dict(sender=ADMIN)),
                ('dispurse_donations', None, dict(sender=DONOR, source=ADMIN, balance=13)),
                ('set_baker', BAKER, dict(sender=ADMIN, amount=1, balance=14))]
    for entry, value, ctx in failures:
        with pytest.raises(MichelsonRuntimeError):
            run(entry, value, s, **ctx)
        assert s == before


def test_exact_surface_and_generated_artifact():
    from test_contract import contract, ROOT
    from importlib.util import module_from_spec, spec_from_file_location
    spec = spec_from_file_location('builder', ROOT / 'src/build_contract.py')
    builder = module_from_spec(spec)
    spec.loader.exec_module(builder)
    assert (ROOT / 'contracts/donations.tz').read_text() == builder.build()
    assert set(contract().entrypoints) == {'donate', 'Update_donation_routing', 'dispurse_donations', 'set_baker', 'default'}
