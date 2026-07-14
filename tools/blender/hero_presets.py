#!/usr/bin/env python3
"""Deterministic loader and contract guard for committed hero presets.

This module intentionally has no ``bpy`` dependency, so the preset contract can
be checked with ordinary Python before spending time on a Blender render.
"""

import hashlib
import json
import math
import os
import re


HERE = os.path.dirname(os.path.abspath(__file__))
PARAM_DIR = os.path.join(HERE, 'hero_params')
BUILTIN_HERO_IDS = ('elf', 'orc', 'wizard', 'berserker', 'assassin')
_SAFE_HERO_NAME = re.compile(r'^[a-z][a-z0-9_-]*$')
_HEX_COLOUR = re.compile(r'^#[0-9a-fA-F]{6}$')

# These values determine the evaluated hand path, lower silhouette/ground dy,
# or vertical body framing. Built-in class identity must not move them.
CONTRACT_LOCKED_KEYS = (
    'arm_r', 'arm_x', 'arm_top_z', 'arm_bot_z',
    'leg_r', 'leg_x', 'leg_top_z', 'foot_r', 'foot_y',
    'body_z', 'body_rz', 'belly_rz',
    'tail_r', 'tail_tuft_r', 'tail_pts',
)

EXPECTED_PALETTES = {
    'elf': {
        'fur': '#3f7d52', 'fur_dark': '#27543a',
        'fur_light': '#62a373', 'face': '#e9f0d8',
        'accent': '#7fe0a0',
    },
    'orc': {
        'fur': '#5f7d3a', 'fur_dark': '#3c5224',
        'fur_light': '#82a352', 'face': '#cdd9a0',
        'accent': '#b6d05a',
    },
    'wizard': {
        'fur': '#5a4b8c', 'fur_dark': '#382f5e',
        'fur_light': '#7d6cc0', 'face': '#e7e0f5',
        'accent': '#a78bff',
    },
    'berserker': {
        'fur': '#a23a2a', 'fur_dark': '#6e2017',
        'fur_light': '#d65a3e', 'face': '#f3cdb9',
        'accent': '#ff6a3c',
    },
    'assassin': {
        'fur': '#3a4a66', 'fur_dark': '#222d42',
        'fur_light': '#5a6e92', 'face': '#dfe6f2',
        'accent': '#7fd0ff',
    },
}


def canonical_digest(delta):
    """Stable SHA-256 for a semantic JSON delta (whitespace independent)."""
    payload = json.dumps(delta, sort_keys=True, separators=(',', ':'))
    return hashlib.sha256(payload.encode('utf-8')).hexdigest()


def _validate_delta(hero, delta, defaults, source_path):
    if not isinstance(delta, dict):
        raise ValueError(f'{source_path}: hero params must be a JSON object')

    unknown = sorted(set(delta) - set(defaults))
    if unknown:
        raise ValueError(
            f'{source_path}: unknown monkey_rig parameter(s): '
            f'{", ".join(unknown)}')

    changed_locked = [key for key in CONTRACT_LOCKED_KEYS
                      if key in delta and delta[key] != defaults[key]]
    if changed_locked:
        raise ValueError(
            f'{source_path}: contract-locked parameter(s) changed: '
            f'{", ".join(changed_locked)}')

    for key, value in delta.items():
        baseline = defaults[key]
        if isinstance(baseline, (int, float)):
            if (isinstance(value, bool) or
                    not isinstance(value, (int, float)) or
                    not math.isfinite(value)):
                raise ValueError(f'{source_path}: {key} must be finite numeric')

    for key in ('fur', 'fur_dark', 'fur_light', 'face', 'face_dark',
                'eye', 'accent'):
        if (key in delta and
                (not isinstance(delta[key], str) or
                 not _HEX_COLOUR.fullmatch(delta[key]))):
            raise ValueError(f'{source_path}: {key} must be #rrggbb')

    if hero in EXPECTED_PALETTES:
        palette = EXPECTED_PALETTES[hero]
        mismatches = [key for key, expected in palette.items()
                      if delta.get(key) != expected]
        if mismatches:
            raise ValueError(
                f'{source_path}: {hero} palette mismatch: '
                f'{", ".join(mismatches)}')
        identity_keys = ('head_r', 'head_wide', 'body_rx', 'body_ry')
        missing = [key for key in identity_keys if key not in delta]
        if missing:
            raise ValueError(
                f'{source_path}: incomplete body identity: '
                f'{", ".join(missing)}')


def load_hero_delta(hero, defaults, explicit_path=None):
    """Return ``(delta, source_path, digest)`` for a render request.

    ``monkey`` without an explicit path remains the canonical no-delta build.
    Named built-ins auto-resolve to ``hero_params/<hero>.json``. An unknown
    output name must supply ``HERO_PARAMS`` explicitly; it can never silently
    render and label the monkey body as a different hero.
    """
    if not _SAFE_HERO_NAME.fullmatch(hero):
        raise ValueError(f'unsafe HERO_NAME: {hero!r}')

    if explicit_path:
        source_path = os.path.abspath(explicit_path)
    elif hero in BUILTIN_HERO_IDS:
        source_path = os.path.join(PARAM_DIR, f'{hero}.json')
    elif hero == 'monkey':
        return None, None, None
    else:
        raise ValueError(
            f'unknown HERO_NAME {hero!r}; set HERO_PARAMS to an explicit JSON '
            f'delta or use one of: monkey, {", ".join(BUILTIN_HERO_IDS)}')

    if not os.path.isfile(source_path):
        raise FileNotFoundError(f'hero params file not found: {source_path}')
    with open(source_path, encoding='utf-8') as handle:
        delta = json.load(handle)
    _validate_delta(hero, delta, defaults, source_path)
    return delta, source_path, canonical_digest(delta)
