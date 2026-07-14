# Committed hero parameter presets

These JSON files are deterministic deltas over `monkey_rig.DEFAULT_PARAMS`.
`render_sheets.py` selects the matching file automatically when `HERO_NAME`
is one of `elf`, `orc`, `wizard`, `berserker`, or `assassin` and
`HERO_PARAMS` is not set.

The presets may change palette, head/face proportions, and horizontal torso
proportions. They deliberately do not change the canonical arm, hand, leg,
foot, tail, pose, camera, or root-bob geometry. That keeps the GRIP path,
ground alignment, head-centre line, feet line, and 48-grid framing contract
stable while allowing each hero to export its own exact head-seat and shoulder
anchors.

The renderer validates every built-in preset before Blender creates geometry.
Unknown parameter names and changes to a contract-locked key fail the build.
