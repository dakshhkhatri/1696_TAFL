from flask import Flask, request, jsonify
from flask_cors import CORS
from collections import deque, defaultdict

app = Flask(__name__)
CORS(app)

# ══════════════════════════════════════════════
#  STATE COUNTER
# ══════════════════════════════════════════════
_sid = [0]

def reset():
    _sid[0] = 0

def nstate():
    s = _sid[0]
    _sid[0] += 1
    return s


# ══════════════════════════════════════════════
#  TOKENIZER
#  Supported:
#   +  -> union
#   |  -> union
#   *  -> kleene star
#   ε  -> epsilon
#  Removed:
#   ?  -> no longer supported
# ══════════════════════════════════════════════
def tokenize(regex):
    toks = []
    i = 0
    while i < len(regex):
        c = regex[i]

        if c == '\\' and i + 1 < len(regex):
            toks.append(('char', regex[i + 1]))
            i += 2
        elif c == 'ε':
            toks.append(('eps', 'ε'))
            i += 1
        elif c in '()|+*':
            toks.append((c, c))
            i += 1
        else:
            toks.append(('char', c))
            i += 1

    return toks


# ══════════════════════════════════════════════
#  RECURSIVE-DESCENT PARSER → AST
# ══════════════════════════════════════════════
class Parser:
    def __init__(self, toks):
        self.toks = toks
        self.pos = 0

    def peek(self):
        return self.toks[self.pos] if self.pos < len(self.toks) else None

    def eat(self):
        t = self.toks[self.pos]
        self.pos += 1
        return t

    def expr(self):
        node = self.term()
        while self.peek() and self.peek()[0] in ('|', '+'):
            self.eat()
            right = self.term()
            node = {'t': 'union', 'l': node, 'r': right}
        return node

    def term(self):
        node = self.factor()
        while self.peek() and self.peek()[0] not in ('|', '+', ')'):
            right = self.factor()
            node = {'t': 'cat', 'l': node, 'r': right}
        return node

    def factor(self):
        node = self.atom()
        while self.peek() and self.peek()[0] == '*':
            self.eat()
            node = {'t': '*', 'c': node}
        return node

    def atom(self):
        t = self.peek()

        if t is None:
            raise ValueError("Unexpected end of expression")

        if t[0] == '(':
            self.eat()
            node = self.expr()
            if not self.peek() or self.peek()[0] != ')':
                raise ValueError("Missing closing parenthesis ')'")
            self.eat()
            return node

        if t[0] == 'char':
            self.eat()
            return {'t': 'char', 'v': t[1]}

        if t[0] == 'eps':
            self.eat()
            return {'t': 'eps'}

        raise ValueError(f"Unexpected token '{t[1]}'")


# ══════════════════════════════════════════════
#  HELPERS
# ══════════════════════════════════════════════
def _uniq(lst):
    seen = set()
    out = []
    for x in lst:
        if x not in seen:
            seen.add(x)
            out.append(x)
    return out

def _sorted_unique_transitions(transitions):
    seen = set()
    out = []
    for t in transitions:
        key = (t['from'], t['sym'], t['to'])
        if key not in seen:
            seen.add(key)
            out.append({'from': t['from'], 'sym': t['sym'], 'to': t['to']})
    out.sort(key=lambda x: (x['from'], x['sym'], x['to']))
    return out

def _alphabet_from_transitions(transitions):
    return sorted(set(t['sym'] for t in transitions if t['sym'] != 'ε'))

def move(states, sym, transitions):
    out = set()
    for s in states:
        for t in transitions:
            if t['from'] == s and t['sym'] == sym:
                out.add(t['to'])
    return out

def reachable_states(start, transitions):
    g = defaultdict(list)
    for t in transitions:
        g[t['from']].append(t['to'])

    vis = {start}
    q = deque([start])

    while q:
        u = q.popleft()
        for v in g[u]:
            if v not in vis:
                vis.add(v)
                q.append(v)

    return vis

def productive_states(accept_states, transitions):
    rg = defaultdict(list)
    for t in transitions:
        rg[t['to']].append(t['from'])

    vis = set(accept_states)
    q = deque(accept_states)

    while q:
        u = q.popleft()
        for v in rg[u]:
            if v not in vis:
                vis.add(v)
                q.append(v)

    return vis

def trim_nfa(nfa):
    trans = _sorted_unique_transitions(nfa['transitions'])
    start = nfa['start']
    accept_states = sorted(_uniq(nfa.get('accept_states', [])))
    alphabet = nfa.get('alphabet', _alphabet_from_transitions(trans))

    if not nfa.get('states'):
        return {
            'start': start,
            'accept_states': accept_states,
            'states': [start],
            'transitions': [],
            'alphabet': alphabet
        }

    reach = reachable_states(start, trans)
    prod = productive_states(accept_states, trans)
    keep = reach & prod

    if start not in keep:
        keep.add(start)

    reduced_trans = [
        t for t in trans
        if t['from'] in keep and t['to'] in keep
    ]
    reduced_accepts = [a for a in accept_states if a in keep]

    return {
        'start': start,
        'accept_states': sorted(_uniq(reduced_accepts)),
        'states': sorted(keep),
        'transitions': _sorted_unique_transitions(reduced_trans),
        'alphabet': alphabet
    }

def make_step(label, description, frag, new_states, new_transitions, layout_hint, step_type):
    return {
        'label': label,
        'description': description,
        'states': frag['states'],
        'transitions': frag['transitions'],
        'new_states': new_states,
        'new_transitions': new_transitions,
        'start_state': frag['start'],
        'accept_state': frag['accept'],
        'layout_hint': layout_hint,
        'step_type': step_type
    }


# ══════════════════════════════════════════════
#  THOMPSON'S CONSTRUCTION
# ══════════════════════════════════════════════
def thompson(node, steps):
    t = node['t']

    if t == 'char':
        s = nstate()
        a = nstate()
        trans = {'from': s, 'sym': node['v'], 'to': a}

        frag = {
            'start': s,
            'accept': a,
            'states': [s, a],
            'transitions': [trans]
        }

        steps.append(make_step(
            label=f"Build symbol '{node['v']}'",
            description=f"Create the basic fragment for '{node['v']}' using q{s} --{node['v']}→ q{a}.",
            frag=frag,
            new_states=[s, a],
            new_transitions=[trans],
            layout_hint='symbol',
            step_type='char'
        ))
        return frag

    if t == 'eps':
        s = nstate()
        a = nstate()
        trans = {'from': s, 'sym': 'ε', 'to': a}

        frag = {
            'start': s,
            'accept': a,
            'states': [s, a],
            'transitions': [trans]
        }

        steps.append(make_step(
            label="Build epsilon fragment",
            description=f"Create the ε fragment q{s} --ε→ q{a}.",
            frag=frag,
            new_states=[s, a],
            new_transitions=[trans],
            layout_hint='epsilon',
            step_type='eps'
        ))
        return frag

    if t == 'cat':
        left = thompson(node['l'], steps)
        right = thompson(node['r'], steps)

        eps = {'from': left['accept'], 'sym': 'ε', 'to': right['start']}

        frag = {
            'start': left['start'],
            'accept': right['accept'],
            'states': _uniq(left['states'] + right['states']),
            'transitions': left['transitions'] + right['transitions'] + [eps]
        }

        steps.append(make_step(
            label='Attach by concatenation',
            description=f"Attach the second fragment after the first by adding q{left['accept']} --ε→ q{right['start']}.",
            frag=frag,
            new_states=[],
            new_transitions=[eps],
            layout_hint='concat',
            step_type='cat'
        ))
        return frag

    if t == 'union':
        left = thompson(node['l'], steps)
        right = thompson(node['r'], steps)

        s = nstate()
        a = nstate()

        new_trans = [
            {'from': s, 'sym': 'ε', 'to': left['start']},
            {'from': s, 'sym': 'ε', 'to': right['start']},
            {'from': left['accept'], 'sym': 'ε', 'to': a},
            {'from': right['accept'], 'sym': 'ε', 'to': a},
        ]

        frag = {
            'start': s,
            'accept': a,
            'states': _uniq([s, a] + left['states'] + right['states']),
            'transitions': left['transitions'] + right['transitions'] + new_trans
        }

        steps.append(make_step(
            label='Join with union (+)',
            description=f"Add new start q{s} and new accept q{a}, then branch to both fragments and merge them back.",
            frag=frag,
            new_states=[s, a],
            new_transitions=new_trans,
            layout_hint='union',
            step_type='union'
        ))
        return frag

    if t == '*':
        inner = thompson(node['c'], steps)

        s = nstate()
        a = nstate()

        new_trans = [
            {'from': s, 'sym': 'ε', 'to': inner['start']},
            {'from': s, 'sym': 'ε', 'to': a},
            {'from': inner['accept'], 'sym': 'ε', 'to': inner['start']},
            {'from': inner['accept'], 'sym': 'ε', 'to': a},
        ]

        frag = {
            'start': s,
            'accept': a,
            'states': _uniq([s, a] + inner['states']),
            'transitions': inner['transitions'] + new_trans
        }

        steps.append(make_step(
            label='Wrap with Kleene star (*)',
            description="Add entry, skip, repeat, and exit ε-transitions around the fragment.",
            frag=frag,
            new_states=[s, a],
            new_transitions=new_trans,
            layout_hint='star',
            step_type='star'
        ))
        return frag

    raise ValueError(f"Unknown AST node {t}")


# ══════════════════════════════════════════════
#  ε-CLOSURE
# ══════════════════════════════════════════════
def eps_closure(states, transitions):
    closure = set(states)
    stack = list(states)

    while stack:
        s = stack.pop()
        for t in transitions:
            if t['from'] == s and t['sym'] == 'ε' and t['to'] not in closure:
                closure.add(t['to'])
                stack.append(t['to'])

    return frozenset(closure)


# ══════════════════════════════════════════════
#  ε-NFA → NFA TABLE DATA ONLY
# ══════════════════════════════════════════════
def enfa_to_nfa_table(enfa):
    trans = enfa['transitions']
    states = sorted(_uniq(enfa['states']))
    alphabet = _alphabet_from_transitions(trans)

    steps = []

    for state in states:
        closure_state = sorted(list(eps_closure([state], trans)))
        moves = {}

        for sym in alphabet:
            direct = move(closure_state, sym, trans)
            target_states = sorted(list(eps_closure(list(direct), trans))) if direct else []
            moves[sym] = target_states

        new_transitions = []
        for sym, arr in moves.items():
            for dest in arr:
                new_transitions.append({'from': state, 'sym': sym, 'to': dest})

        steps.append({
            'source_state': state,
            'source_label': f"q{state}",
            'label': f"Compute direct moves for q{state}",
            'description': f"Take ε-closure(q{state}) and replace ε-paths by direct symbol transitions.",
            'eclosure': closure_state,
            'moves': moves,
            'new_transitions': new_transitions
        })

    return {
        'states': states,
        'alphabet': alphabet,
        'steps': steps
    }


# ══════════════════════════════════════════════
#  DIRECT ε-FREE NFA (POSITION / GLUSHKOV STYLE)
# ══════════════════════════════════════════════
def clone_ast(node):
    if node is None:
        return None
    out = dict(node)
    if 'l' in node:
        out['l'] = clone_ast(node['l'])
    if 'r' in node:
        out['r'] = clone_ast(node['r'])
    if 'c' in node:
        out['c'] = clone_ast(node['c'])
    return out

def assign_positions(node, pos_counter, pos_symbol):
    t = node['t']

    if t == 'char':
        p = pos_counter[0]
        pos_counter[0] += 1
        node['pos'] = p
        pos_symbol[p] = node['v']
        return

    if t == 'eps':
        return

    if t in ('union', 'cat'):
        assign_positions(node['l'], pos_counter, pos_symbol)
        assign_positions(node['r'], pos_counter, pos_symbol)
        return

    if t == '*':
        assign_positions(node['c'], pos_counter, pos_symbol)
        return

def compute_regex_props(node, followpos):
    t = node['t']

    if t == 'char':
        return {
            'nullable': False,
            'firstpos': {node['pos']},
            'lastpos': {node['pos']}
        }

    if t == 'eps':
        return {
            'nullable': True,
            'firstpos': set(),
            'lastpos': set()
        }

    if t == 'union':
        left = compute_regex_props(node['l'], followpos)
        right = compute_regex_props(node['r'], followpos)
        return {
            'nullable': left['nullable'] or right['nullable'],
            'firstpos': set(left['firstpos']) | set(right['firstpos']),
            'lastpos': set(left['lastpos']) | set(right['lastpos'])
        }

    if t == 'cat':
        left = compute_regex_props(node['l'], followpos)
        right = compute_regex_props(node['r'], followpos)

        for i in left['lastpos']:
            followpos[i].update(right['firstpos'])

        firstpos = set(left['firstpos'])
        if left['nullable']:
            firstpos |= set(right['firstpos'])

        lastpos = set(right['lastpos'])
        if right['nullable']:
            lastpos |= set(left['lastpos'])

        return {
            'nullable': left['nullable'] and right['nullable'],
            'firstpos': firstpos,
            'lastpos': lastpos
        }

    if t == '*':
        child = compute_regex_props(node['c'], followpos)

        for i in child['lastpos']:
            followpos[i].update(child['firstpos'])

        return {
            'nullable': True,
            'firstpos': set(child['firstpos']),
            'lastpos': set(child['lastpos'])
        }

    raise ValueError(f"Unknown AST node {t}")

def direct_position_nfa(ast):
    ast_copy = clone_ast(ast)
    pos_counter = [1]
    pos_symbol = {}
    assign_positions(ast_copy, pos_counter, pos_symbol)

    followpos = defaultdict(set)
    props = compute_regex_props(ast_copy, followpos)

    positions = sorted(pos_symbol.keys())
    alphabet = sorted(set(pos_symbol.values()))

    states = [0] + positions
    start = 0
    accept_states = set(props['lastpos'])
    if props['nullable']:
        accept_states.add(0)

    transitions = []

    for p in sorted(props['firstpos']):
        transitions.append({'from': 0, 'sym': pos_symbol[p], 'to': p})

    for i in positions:
        for j in sorted(followpos[i]):
            transitions.append({'from': i, 'sym': pos_symbol[j], 'to': j})

    nfa = {
        'start': start,
        'accept_states': sorted(accept_states),
        'states': states,
        'transitions': _sorted_unique_transitions(transitions),
        'alphabet': alphabet
    }
    return trim_nfa(nfa)


# ══════════════════════════════════════════════
#  MERGE EQUIVALENT NFA STATES
# ══════════════════════════════════════════════
def merge_equivalent_nfa_states(nfa):
    states = sorted(_uniq(nfa['states']))
    start = nfa['start']
    accept_states = set(nfa.get('accept_states', []))
    alphabet = list(nfa.get('alphabet', []))
    transitions = _sorted_unique_transitions(nfa['transitions'])

    if not states:
        return nfa

    out_map = {s: {sym: set() for sym in alphabet} for s in states}
    for t in transitions:
        if t['from'] in out_map and t['sym'] in out_map[t['from']]:
            out_map[t['from']][t['sym']].add(t['to'])

    accepts = {s for s in states if s in accept_states}
    non_accepts = set(states) - accepts

    partitions = []
    if accepts:
        partitions.append(accepts)
    if non_accepts:
        partitions.append(non_accepts)
    if not partitions:
        partitions = [set(states)]

    changed = True
    while changed:
        changed = False
        state_to_part = {}
        for i, part in enumerate(partitions):
            for s in part:
                state_to_part[s] = i

        new_partitions = []
        for part in partitions:
            groups = defaultdict(set)

            for s in part:
                sig = []
                for sym in alphabet:
                    dest_parts = sorted(
                        set(state_to_part[d] for d in out_map[s][sym] if d in state_to_part)
                    )
                    sig.append((sym, tuple(dest_parts)))
                groups[tuple(sig)].add(s)

            split = list(groups.values())
            new_partitions.extend(split)
            if len(split) > 1:
                changed = True

        partitions = new_partitions

    part_id = {}
    for i, part in enumerate(partitions):
        for s in part:
            part_id[s] = i

    merged_states = list(range(len(partitions)))
    merged_start = part_id[start]
    merged_accepts = sorted(_uniq([part_id[s] for s in accept_states if s in part_id]))

    merged_transitions = []
    for i, part in enumerate(partitions):
        members = list(part)
        for sym in alphabet:
            merged_targets = set()
            for s in members:
                for d in out_map[s][sym]:
                    merged_targets.add(part_id[d])
            for mt in sorted(merged_targets):
                merged_transitions.append({'from': i, 'sym': sym, 'to': mt})

    merged_nfa = {
        'start': merged_start,
        'accept_states': merged_accepts,
        'states': merged_states,
        'transitions': _sorted_unique_transitions(merged_transitions),
        'alphabet': alphabet
    }
    return trim_nfa(merged_nfa)

def build_visual_reduced_nfa(ast):
    direct_nfa = direct_position_nfa(ast)
    merged = merge_equivalent_nfa_states(direct_nfa)
    return trim_nfa(merged)


# ══════════════════════════════════════════════
#  NFA → DFA
# ══════════════════════════════════════════════
def subset_construction_from_nfa(nfa):
    trans = nfa['transitions']
    alphabet = nfa.get('alphabet') or _alphabet_from_transitions(trans)

    start_set = frozenset([nfa['start']])
    dfa_states = {}
    dfa_trans = []
    dfa_steps = []
    worklist = [start_set]
    visited = set()
    _did = [0]

    def get_id(fs):
        if fs not in dfa_states:
            dfa_states[fs] = _did[0]
            _did[0] += 1
        return dfa_states[fs]

    get_id(start_set)
    nfa_accepts = set(nfa.get('accept_states', []))

    while worklist:
        cur = worklist.pop(0)
        if cur in visited:
            continue

        visited.add(cur)
        from_id = get_id(cur)
        step_moves = {}
        current_new_transitions = []

        for sym in alphabet:
            moved = sorted(list(move(cur, sym, trans)))
            step_moves[sym] = moved

            if not moved:
                continue

            nxt = frozenset(moved)
            to_id = get_id(nxt)

            edge = {'from': from_id, 'sym': sym, 'to': to_id}
            dfa_trans.append(edge)
            current_new_transitions.append(edge)

            if nxt not in visited and nxt not in worklist:
                worklist.append(nxt)

        accept_states = [
            get_id(fs)
            for fs in dfa_states
            if any(s in nfa_accepts for s in fs)
        ]
        accept_states = sorted(_uniq(accept_states))

        dfa_steps.append({
            'dfa_state': from_id,
            'nfa_states': sorted(list(cur)),
            'label': f"D{from_id} = {{{', '.join(f'q{s}' for s in sorted(cur))}}}",
            'description': f"Create DFA state D{from_id} from the NFA state set {sorted(list(cur))}, then add its outgoing transitions.",
            'moves': {sym: step_moves[sym] for sym in alphabet},
            'states': list(range(_did[0])),
            'transitions': list(dfa_trans),
            'new_states': [from_id],
            'new_transitions': current_new_transitions,
            'start': get_id(start_set),
            'accept_states': accept_states,
            'snapshot': {
                'states': list(range(_did[0])),
                'transitions': list(dfa_trans),
                'start': get_id(start_set),
                'accept_states': accept_states,
                'state_labels': {
                    str(get_id(fs)): sorted(list(fs)) for fs in dfa_states
                },
                'new_states': [from_id],
                'new_transitions': current_new_transitions
            }
        })

    accept_states = [
        get_id(fs)
        for fs in dfa_states
        if any(s in nfa_accepts for s in fs)
    ]
    accept_states = sorted(_uniq(accept_states))

    return {
        'start': get_id(start_set),
        'accept_states': accept_states,
        'states': list(range(_did[0])),
        'transitions': _sorted_unique_transitions(dfa_trans),
        'alphabet': alphabet,
        'state_labels': {str(get_id(fs)): sorted(list(fs)) for fs in dfa_states},
        'steps': dfa_steps,
    }


# ══════════════════════════════════════════════
#  COMPLETE DFA
# ══════════════════════════════════════════════
def complete_dfa(dfa):
    states = sorted(_uniq(dfa['states']))
    alphabet = list(dfa.get('alphabet', []))
    start = dfa['start']
    accept_states = sorted(_uniq(dfa.get('accept_states', [])))
    transitions = _sorted_unique_transitions(dfa['transitions'])

    delta = {}
    for t in transitions:
        delta[(t['from'], t['sym'])] = t['to']

    dead_state = None

    for s in list(states):
        for sym in alphabet:
            if (s, sym) not in delta:
                if dead_state is None:
                    dead_state = max(states) + 1 if states else 0
                delta[(s, sym)] = dead_state

    if dead_state is not None:
        if dead_state not in states:
            states.append(dead_state)

        for sym in alphabet:
            delta[(dead_state, sym)] = dead_state

    completed_transitions = []
    for s in states:
        for sym in alphabet:
            completed_transitions.append({
                'from': s,
                'sym': sym,
                'to': delta[(s, sym)]
            })

    state_labels = dict(dfa.get('state_labels', {}))
    if dead_state is not None:
        state_labels[str(dead_state)] = ['Dead']

    return {
        'start': start,
        'accept_states': accept_states,
        'states': sorted(states),
        'transitions': _sorted_unique_transitions(completed_transitions),
        'alphabet': alphabet,
        'state_labels': state_labels,
        'steps': dfa.get('steps', [])
    }


# ══════════════════════════════════════════════
#  DFA MINIMIZATION
# ══════════════════════════════════════════════
def minimize_dfa(dfa):
    dfa = complete_dfa(dfa)

    states = sorted(dfa['states'])
    alphabet = list(dfa.get('alphabet', []))
    start = dfa['start']
    accepts = set(dfa.get('accept_states', []))
    trans = dfa['transitions']

    delta = {}
    for t in trans:
        delta[(t['from'], t['sym'])] = t['to']

    partitions = []
    non_accepts = set(states) - accepts

    if accepts:
        partitions.append(set(accepts))
    if non_accepts:
        partitions.append(set(non_accepts))

    if not partitions:
        partitions = [set([start])]

    changed = True
    while changed:
        changed = False
        new_partitions = []

        state_to_part = {}
        for i, part in enumerate(partitions):
            for s in part:
                state_to_part[s] = i

        for part in partitions:
            groups = defaultdict(set)

            for s in part:
                sig = []
                for sym in alphabet:
                    nxt = delta.get((s, sym))
                    sig.append(state_to_part.get(nxt, -1))
                groups[tuple(sig)].add(s)

            split_parts = list(groups.values())
            new_partitions.extend(split_parts)

            if len(split_parts) > 1:
                changed = True

        partitions = new_partitions

    part_id = {}
    for i, part in enumerate(partitions):
        for s in part:
            part_id[s] = i

    min_states = list(range(len(partitions)))
    min_start = part_id[start]
    min_accepts = sorted(_uniq([part_id[s] for s in accepts]))

    min_trans = []
    for i, part in enumerate(partitions):
        rep = next(iter(part))
        for sym in alphabet:
            nxt = delta[(rep, sym)]
            min_trans.append({
                'from': i,
                'sym': sym,
                'to': part_id[nxt]
            })

    min_trans = _sorted_unique_transitions(min_trans)

    state_labels = {}
    for i, part in enumerate(partitions):
        members = sorted(part)
        state_labels[str(i)] = [f"D{s}" for s in members]

    return {
        'start': min_start,
        'accept_states': min_accepts,
        'states': min_states,
        'transitions': min_trans,
        'alphabet': alphabet,
        'state_labels': state_labels
    }


# ══════════════════════════════════════════════
#  SIMULATION
# ══════════════════════════════════════════════
def simulate_enfa(enfa, input_str):
    trans = enfa['transitions']
    current = eps_closure([enfa['start']], trans)
    trace = [{'char': None, 'states': sorted(list(current))}]

    for ch in input_str:
        moved = set()
        for s in current:
            for t in trans:
                if t['from'] == s and t['sym'] == ch:
                    moved.add(t['to'])

        current = eps_closure(list(moved), trans)
        trace.append({'char': ch, 'states': sorted(list(current))})

        if not current:
            break

    return enfa['accept'] in current, trace

def simulate_nfa(nfa, input_str):
    current = {nfa['start']}
    trace = [{'char': None, 'states': sorted(list(current))}]
    accept_states = set(nfa.get('accept_states', []))
    trans = nfa['transitions']

    for ch in input_str:
        nxt = set()
        for s in current:
            for t in trans:
                if t['from'] == s and t['sym'] == ch:
                    nxt.add(t['to'])
        current = nxt
        trace.append({'char': ch, 'states': sorted(list(current))})

        if not current:
            break

    return bool(current & accept_states), trace

def simulate_dfa(dfa, input_str):
    cur = dfa['start']
    trace = [{'char': None, 'state': cur}]

    for ch in input_str:
        nxt = None
        for t in dfa['transitions']:
            if t['from'] == cur and t['sym'] == ch:
                nxt = t['to']
                break

        if nxt is None:
            trace.append({'char': ch, 'state': None, 'dead': True})
            return False, trace

        cur = nxt
        trace.append({'char': ch, 'state': cur})

    return cur in dfa['accept_states'], trace


# ══════════════════════════════════════════════
#  API ROUTES
# ══════════════════════════════════════════════
@app.route('/api/convert', methods=['POST'])
def convert():
    data = request.get_json() or {}
    regex = data.get('regex', '').strip()

    if not regex:
        return jsonify({'error': 'No regex provided'}), 400

    if '?' in regex:
        return jsonify({'error': "Operator '?' is no longer supported. Use only +, |, *, parentheses, characters, and ε."}), 400

    try:
        reset()
        toks = tokenize(regex)
        parser = Parser(toks)
        ast = parser.expr()

        if parser.pos < len(toks):
            raise ValueError(f"Unexpected character at pos {parser.pos + 1}: '{toks[parser.pos][1]}'")

        enfa_steps = []
        enfa = thompson(ast, enfa_steps)
        enfa['states'] = _uniq(enfa['states'])

        nfa_table = enfa_to_nfa_table(enfa)
        nfa = build_visual_reduced_nfa(ast)
        dfa = subset_construction_from_nfa(nfa)
        dfa = complete_dfa(dfa)
        min_dfa = minimize_dfa(dfa)

        return jsonify({
            'regex': regex,
            'enfa': enfa,
            'enfa_steps': enfa_steps,
            'nfa': nfa,
            'nfa_steps': nfa_table['steps'],
            'dfa': dfa,
            'dfa_steps': dfa['steps'],
            'min_dfa': min_dfa
        })

    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': f'Internal: {e}'}), 500


@app.route('/api/simulate', methods=['POST'])
def simulate():
    data = request.get_json() or {}
    regex = data.get('regex', '').strip()
    inp = data.get('input', '')

    if not regex:
        return jsonify({'error': 'No regex'}), 400

    if '?' in regex:
        return jsonify({'error': "Operator '?' is no longer supported. Use only +, |, *, parentheses, characters, and ε."}), 400

    try:
        reset()
        toks = tokenize(regex)
        parser = Parser(toks)
        ast = parser.expr()

        enfa = thompson(ast, [])
        nfa = build_visual_reduced_nfa(ast)
        dfa = subset_construction_from_nfa(nfa)
        dfa = complete_dfa(dfa)
        min_dfa = minimize_dfa(dfa)

        enfa_ok, enfa_trace = simulate_enfa(enfa, inp)
        nfa_ok, plain_nfa_trace = simulate_nfa(nfa, inp)
        dfa_ok, dfa_trace = simulate_dfa(dfa, inp)
        min_dfa_ok, min_dfa_trace = simulate_dfa(min_dfa, inp)

        return jsonify({
            'accepted': enfa_ok,
            'accepted_enfa': enfa_ok,
            'accepted_nfa': nfa_ok,
            'accepted_dfa': dfa_ok,
            'accepted_min_dfa': min_dfa_ok,
            'nfa_trace': enfa_trace,
            'enfa_trace': enfa_trace,
            'plain_nfa_trace': plain_nfa_trace,
            'dfa_trace': dfa_trace,
            'min_dfa_trace': min_dfa_trace,
            'input': inp
        })

    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        return jsonify({'error': f'Internal: {e}'}), 500


@app.route('/api/health')
def health():
    return jsonify({'status': 'ok'})


if __name__ == '__main__':
    app.run(debug=True, port=5000)
    