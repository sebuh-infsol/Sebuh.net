import pytest
from pytezos.michelson.micheline import MichelsonRuntimeError
from pathlib import Path
from pytezos import ContractInterface

ROOT = Path(__file__).resolve().parents[1]
ADMIN = 'tz1VSUr8wwNhLAzempoch5d6hLRiTh8Cjcjb'
DONOR = 'tz1aSkwEot3L2kmUvcoxzjMomb9mvBNuzFK6'
RECIPIENT = 'tz1burnburnburnburnburnburnburjAYjjX'
SELF = 'KT1RJ6PbjHpwc3M5rw5s2Nbmefwbuwbdxton'
BAKER = ADMIN

def contract():
    path = ROOT / 'contracts/donations.tz'
    assert path.exists(), 'Donation contract is not implemented'
    return ContractInterface.from_file(str(path))

def storage():
    return dict(admin=ADMIN, donation_recipient=RECIPIENT, selected_baker=None,
                next_donation_id=0, donations={}, total_donated=0, total_disbursed=0)

def run(entry, value, state=None, **context):
    context = dict(dict(sender=DONOR, source=DONOR, amount=0, balance=0,
                        now=1700000000, level=123, self_address=SELF), **context)
    return getattr(contract(), entry)(value).interpret(storage=state or storage(), **context)

def test_basic_donation():
    r = run('donate', b'hello', amount=123, balance=123)
    assert r.storage['next_donation_id'] == 1
    assert r.storage['total_donated'] == 123
    assert r.storage['total_disbursed'] == 0
    assert r.storage['donations'][0] == dict(sender=DONOR, amount=123,
        timestamp=1700000000, level=123, memo=b'hello')
    assert r.operations == []

def test_disburse_full_balance():
    r = run('dispurse_donations', None, sender=ADMIN, balance=999)
    assert r.storage == dict(storage(), total_disbursed=999)
    assert len(r.operations) == 1
    op = r.operations[0]
    assert op['kind'] == 'transaction'
    assert op['amount'] == '999'
    assert op['destination'] == RECIPIENT
    assert op['parameters'] == {'entrypoint': 'default', 'value': {'prim': 'Unit'}}

def test_set_baker():
    r = run('set_baker', BAKER, sender=ADMIN)
    assert r.storage == dict(storage(), selected_baker=BAKER)
    assert len(r.operations) == 1
    assert r.operations[0]['kind'] == 'delegation'
    assert r.operations[0]['delegate'] == BAKER

def test_admin_routing():
    r = run('Update_donation_routing', DONOR, sender=ADMIN)
    assert r.storage == dict(storage(), donation_recipient=DONOR)
    assert r.operations == []
