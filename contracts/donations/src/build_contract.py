"""Generate original Michelson; no compiler, RPC, signing, or private keys."""
from pathlib import Path

PARAMETER = '''parameter (or (bytes %donate) (or (address %Update_donation_routing)
    (or (unit %dispurse_donations) (option %set_baker key_hash))));'''
STORAGE = '''storage (pair (address %admin) (address %donation_recipient)
    (option %selected_baker key_hash) (nat %next_donation_id)
    (big_map %donations nat (pair (address %sender) (mutez %amount)
        (timestamp %timestamp) (nat %level) (bytes %memo)))
    (nat %total_donated) (nat %total_disbursed));'''
DONATE = '''AMOUNT; PUSH mutez 0; COMPARE; LT; IF {} { PUSH string "ZERO_DONATION"; FAILWITH };
    LEVEL; NOW; AMOUNT; SENDER; PAIR 5; SOME;
    DIP { DUP; GET 9 }; DUP 3; GET 7; UPDATE; UPDATE 9;
    DUP; GET 7; PUSH nat 1; ADD; UPDATE 7;
    DUP; GET 11; AMOUNT; PUSH mutez 1; SWAP; EDIV;
    IF_NONE { PUSH string "MUTEZ_TO_NAT"; FAILWITH } { CAR }; ADD; UPDATE 11;
    NIL operation; PAIR'''

ADMIN_CHECK = '''DUP 2; GET 1; SENDER; COMPARE; EQ;
    IF {} { PUSH string "NOT_ADMIN"; FAILWITH };
    AMOUNT; PUSH mutez 0; COMPARE; EQ;
    IF {} { PUSH string "ADMIN_AMOUNT"; FAILWITH };'''
ROUTE = '''DUP; SELF_ADDRESS; COMPARE; NEQ;
    IF {} { PUSH string "SELF_RECIPIENT"; FAILWITH };
    DUP; SELF %dispurse_donations; ADDRESS; COMPARE; NEQ;
    IF {} { PUSH string "SELF_RECIPIENT"; FAILWITH };
    DUP; CONTRACT unit; IF_NONE { PUSH string "BAD_RECIPIENT"; FAILWITH } { DROP };
    UPDATE 3; NIL operation; PAIR'''

DISBURSE = '''DROP; BALANCE; PUSH mutez 0; COMPARE; LT;
    IF {} { PUSH string "ZERO_BALANCE"; FAILWITH };
    DUP; GET 3; DUP; SELF_ADDRESS; COMPARE; NEQ;
    IF {} { PUSH string "SELF_RECIPIENT"; FAILWITH };
    DUP; SELF %dispurse_donations; ADDRESS; COMPARE; NEQ;
    IF {} { PUSH string "SELF_RECIPIENT"; FAILWITH };
    CONTRACT unit; IF_NONE { PUSH string "BAD_RECIPIENT"; FAILWITH } {};
    BALANCE; UNIT; TRANSFER_TOKENS;
    DIP { DUP; GET 12; BALANCE; PUSH mutez 1; SWAP; EDIV;
          IF_NONE { PUSH string "MUTEZ_TO_NAT"; FAILWITH } { CAR }; ADD; UPDATE 12 };
    NIL operation; SWAP; CONS; PAIR'''

def memo_validator():
    """Strict RFC 3629 DFA. State: index, remaining, lower, upper, count, bytes."""
    fail = 'PUSH string "MEMO_UTF8"; FAILWITH'
    check = 'IF {} { ' + fail + ' };'
    def state(rem, lo='80', hi='bf'):
        return f'DROP; PUSH nat {rem}; UPDATE 3; PUSH bytes 0x{lo}; UPDATE 5; PUSH bytes 0x{hi}; UPDATE 7'
    # Each ordered threshold branch keeps byte : state on entry.
    cases = [('80', state(0)), ('c2', fail), ('e0', state(1)),
             ('e1', state(2, 'a0')), ('ed', state(2)),
             ('ee', state(2, '80', '9f')), ('f0', state(2)),
             ('f1', state(3, '90')), ('f4', state(3)),
             ('f5', state(3, '80', '8f'))]
    classify = fail
    for limit, body in reversed(cases):
        classify = f'DUP; PUSH bytes 0x{limit}; SWAP; COMPARE; LT; IF {{ {body} }} {{ {classify} }}'
    return '''DUP; SIZE; PUSH nat 2048; COMPARE; GE;
        IF {} { PUSH string "MEMO_BYTES"; FAILWITH };
        DUP; PUSH nat 0; PUSH bytes 0xbf; PUSH bytes 0x80;
        PUSH nat 0; PUSH nat 0; PAIR 6;
        DUP; GET 1; DUP 2; GET 10; SIZE; SWAP; COMPARE; LT;
        LOOP {
            DUP; GET 10; PUSH nat 1; DUP 3; GET 1; SLICE;
            IF_NONE { PUSH string "MEMO_SLICE"; FAILWITH } {};
            DUP 2; GET 3; PUSH nat 0; COMPARE; LT;
            IF {
                DUP; DUP 3; GET 5; SWAP; COMPARE; GE; ''' + check + '''
                DUP; DUP 3; GET 7; SWAP; COMPARE; LE; ''' + check + '''
                DROP; DUP; GET 3; PUSH nat 1; SWAP; SUB;
                ISNAT; IF_NONE { PUSH string "MEMO_STATE"; FAILWITH } {}; UPDATE 3;
                PUSH bytes 0x80; UPDATE 5; PUSH bytes 0xbf; UPDATE 7
            } {
                DIP { DUP; GET 9; PUSH nat 1; ADD; DUP; PUSH nat 512; COMPARE; GE;
                      IF {} { PUSH string "MEMO_CODEPOINTS"; FAILWITH }; UPDATE 9 };
                ''' + classify + '''
            };
            DUP; GET 1; PUSH nat 1; ADD; UPDATE 1;
            DUP; GET 1; DUP 2; GET 10; SIZE; SWAP; COMPARE; LT
        };
        GET 3; PUSH nat 0; COMPARE; EQ;
        IF {} { PUSH string "MEMO_TRUNCATED"; FAILWITH };'''


def build():
    return PARAMETER + '\n' + STORAGE + '\ncode { UNPAIR; IF_LEFT { ' + memo_validator() + DONATE + ' } { ' + ADMIN_CHECK + ' IF_LEFT { ' + ROUTE + ' } { IF_LEFT { ' + DISBURSE + ''' } {
    DUP; DIP { UPDATE 5 }; SET_DELEGATE; NIL operation; SWAP; CONS; PAIR } } } };\n'''

if __name__ == '__main__':
    path = Path(__file__).resolve().parents[1] / 'contracts/donations.tz'
    path.parent.mkdir(exist_ok=True)
    path.write_text(build())
