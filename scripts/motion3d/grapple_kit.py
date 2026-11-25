"""Two-person (grappling) pose toolkit for MARTIALDEX demo animations (Phase 5). Keyframes, no capture.

Each actor is a rig_kit.Rig on its own copy of the character, placed with `placement` (dx, dy, yaw) so that every
pose below is written in THAT actor's own character frame: x = its left, y = its forward, z = up (metres).
A pose state:
  pelvis   {"pos": (x, y, z) offset from the rest pelvis, "yaw", "pitch", "roll"}   pitch > 0 leans forward
  spine    {"yaw", "pitch", "roll"}  spread over spine_01..03 (25/35/40 %)
  head     {"gaze": point, "tuck": deg}
  arms     {"l"|"r": {"target": point, "pole": (x, y, z), "palm": (x, y, z) | None, "fist": bool, "curl": (deg, deg, deg), "flex": deg}}
  legs     {"l"|"r": {"plant": {"ball": (x, y), "yaw", "lift", "pole"}}                       foot planted
                     | {"ankle": point, "pole": (x, y, z), "toes": (x, y, z) | None}}           free leg
A point is a tuple (x, y, z) in the actor's own frame, or a Ref to a bone of either actor (resolved per key, after
that actor has been posed — so a hand can hold the partner's knee). States are blended with blend(); a blend of
two Refs is resolved first and then interpolated in world space.
"""
import copy
import math

from mathutils import Vector

from rig_kit import ease_in_out, smoothstep  # noqa: F401  (re-exported for technique modules)


class Ref:
    """A point on a bone: `who` = actor key ("A"/"B"), `bone`, `at` = 0 head .. 1 tail, `off` = offset in the
    frame of the actor `frame` (default: the actor that owns the bone)."""

    def __init__(self, who, bone, at=0.0, off=(0.0, 0.0, 0.0), frame=None):
        self.who, self.bone, self.at, self.off, self.frame = who, bone, at, off, frame or who

    def resolve(self, rigs, me):
        r = rigs[self.who]
        p = r.head(self.bone).lerp(r.tail(self.bone), self.at)
        return p + rigs[self.frame].cv(*self.off)


class Chest:
    """A point in the CHEST frame of actor `who` (Phase 7, solo strikes / kicks): `off` = (x, y, z) from the spine_03
    head, along that actor's own axes turned with the chest — a guard hand that rides a body turn."""

    def __init__(self, who, off):
        self.who, self.off = who, off

    def resolve(self, rigs, me):
        r = rigs[self.who]
        R = r.world_rot("spine_03") @ r.rest["spine_03"][2].transposed()
        return r.head("spine_03") + R @ r.cv(*self.off)


def chest_rot(rig):
    return rig.world_rot("spine_03") @ rig.rest["spine_03"][2].transposed()


class _Lerp:
    def __init__(self, a, b, t):
        self.a, self.b, self.t = a, b, t

    def resolve(self, rigs, me):
        return point(self.a, rigs, me).lerp(point(self.b, rigs, me), self.t)


def point(p, rigs, me):
    """World position of a point spec for actor `me`."""
    if hasattr(p, "resolve"):
        return p.resolve(rigs, me)
    return rigs[me].cp(*p)


def blend(a, b, t):
    """Element-wise interpolation of two states. Points that involve a Ref are interpolated in world space."""
    if a is b:
        return a
    if hasattr(a, "resolve") or hasattr(b, "resolve"):
        return a if t <= 0 else b if t >= 1 else _Lerp(a, b, t)
    if isinstance(a, dict) and isinstance(b, dict) and (("plant" in a) != ("plant" in b)) and ({"plant", "ankle"} & set(a)) and ({"plant", "ankle"} & set(b)):
        # a foot leaving / reaching the floor: both legs are solved and the ankle + foot are interpolated in world
        return a if t <= 0 else b if t >= 1 else {"mix": (a, b, t)}
    if isinstance(a, dict) and isinstance(b, dict) and "target" in a and "target" in b and ((a.get("elbow") is None) != (b.get("elbow") is None)):
        return a if t <= 0 else b if t >= 1 else {"mixarm": (a, b, t)}
    if isinstance(a, dict):
        keys = set(a) | set(b)
        out = {k: (blend(a[k], b[k], t) if k in a and k in b else (a.get(k) if t < 0.5 else b.get(k))) for k in keys}
        if ("handAim" in a) != ("handAim" in b):
            # Phase 7: a flat hand fades in / out (weight on the aim) instead of snapping at the half-way key
            out["handAim"] = a.get("handAim") or b.get("handAim")
            out["handAimW"] = a.get("handAimW", 1.0) * (1 - t) if "handAim" in a else b.get("handAimW", 1.0) * t
        return out
    if isinstance(a, (int, float)) and isinstance(b, (int, float)):
        return a + (b - a) * t
    if isinstance(a, tuple) and isinstance(b, tuple) and len(a) == len(b) and all(isinstance(x, (int, float)) for x in a + b):
        return tuple(x + (y - x) * t for x, y in zip(a, b))
    return b if t >= 0.5 else a


def deep(s):
    return copy.deepcopy(s)


def keyed(keys, key, ease=ease_in_out):
    """keys: [(key, state), ...] sorted — the state at `key`, eased between neighbours."""
    if key <= keys[0][0]:
        return keys[0][1]
    for (k0, s0), (k1, s1) in zip(keys, keys[1:]):
        if key <= k1:
            return blend(s0, s1, ease((key - k0) / (k1 - k0)))
    return keys[-1][1]


def _scale_rot(q, w):
    from mathutils import Quaternion

    return Quaternion().slerp(q, w).to_matrix()


def pose_body(rig, st):
    """Pelvis, spine, legs and head (everything but the arms) from a state. Returns nothing; the rig is posed."""
    rig.reset()
    p = st["pelvis"]
    rig.move("pelvis", rig.rest["pelvis"][0] + rig.cv(*p["pos"]))
    rig.rotate("pelvis", rig.yaw(p.get("yaw", 0.0)))
    side = rig.yaw(p.get("yaw", 0.0)) @ rig.L
    fwd = rig.yaw(p.get("yaw", 0.0)) @ rig.F
    rig.rotate("pelvis", rig.about(side, p.get("pitch", 0.0)))
    rig.rotate("pelvis", rig.about(fwd, p.get("roll", 0.0)))
    sp = st.get("spine", {})
    for n, w in (("spine_01", 0.25), ("spine_02", 0.35), ("spine_03", 0.40)):
        rig.rotate(n, rig.yaw(sp.get("yaw", 0.0) * w))
        turned = rig.world_rot(n) @ rig.rest[n][2].transposed()
        rig.rotate(n, rig.about(turned @ rig.L, sp.get("pitch", 0.0) * w))
        rig.rotate(n, rig.about(turned @ rig.F, sp.get("roll", 0.0) * w))
    # Phase 7: optional clavicles (protraction, elevation) in degrees, as boxing_stance.solve
    for s, (pro, ele) in (st.get("clavicle") or {}).items():
        if pro or ele:
            Rc = chest_rot(rig)
            d = rig.axis(f"clavicle_{s}")
            rig.aim(f"clavicle_{s}", (d + (Rc @ rig.F) * math.tan(math.radians(pro)) + (Rc @ rig.U) * math.tan(math.radians(ele))).normalized())


def _leg(rig, s, leg, rigs, me):
    if "mix" in leg:
        a, b, t = leg["mix"]
        rig.memo = False  # trial solves (see rig_kit continuity)
        _leg(rig, s, a, rigs, me)
        pa, fa, ba, pole_a = rig.head(f"foot_{s}"), rig.world_rot(f"foot_{s}").to_quaternion(), rig.world_rot(f"ball_{s}").to_quaternion(), rig.head(f"calf_{s}") - rig.head(f"thigh_{s}")
        _leg(rig, s, b, rigs, me)
        pb_, fb, bb, pole_b = rig.head(f"foot_{s}"), rig.world_rot(f"foot_{s}").to_quaternion(), rig.world_rot(f"ball_{s}").to_quaternion(), rig.head(f"calf_{s}") - rig.head(f"thigh_{s}")
        rig.memo = True
        rig.ik2(f"thigh_{s}", f"calf_{s}", pa.lerp(pb_, t), pole_a.lerp(pole_b, t))
        rig.set_world_rot(f"foot_{s}", fa.slerp(fb, t).to_matrix())
        rig.set_world_rot(f"ball_{s}", ba.slerp(bb, t).to_matrix())
        return
    if "plant" in leg:
        f = leg["plant"]
        rig.plant_foot(s, f["ball"], f.get("yaw", 0.0), f.get("lift", 0.0), rig.cv(*f.get("pole", (0.0, 1.0, 0.0))))
    else:
        rig.ik2(f"thigh_{s}", f"calf_{s}", point(leg["ankle"], rigs, me), rig.cv(*leg["pole"]))
        toes = leg.get("toes")
        d = rig.cv(*toes).normalized() if toes else rig.axis(f"calf_{s}")
        rig.aim(f"foot_{s}", d)
        rig.aim(f"ball_{s}", d)


def pose_legs(rig, st, rigs, me):
    for s in ("l", "r"):
        _leg(rig, s, st["legs"][s], rigs, me)


def pose_head(rig, st, rigs, me):
    h = st.get("head")
    if not h:
        return
    gaze = point(h["gaze"], rigs, me)
    face_local = rig.rest["head"][2].transposed() @ rig.F
    for n, w in (("neck_01", 0.4), ("head", 1.0)):
        cur = rig.world_rot("head") @ face_local
        want = (gaze - rig.head("head")).normalized()
        q = cur.rotation_difference(want)
        rig.rotate(n, q.to_matrix() if w == 1.0 else _scale_rot(q, w))
    side_h = rig.world_rot("head") @ (rig.rest["head"][2].transposed() @ rig.L)
    rig.rotate("head", rig.about(side_h, -h.get("tuck", 0.0)))


_ARM_BONES = ("upperarm", "lowerarm", "hand") + tuple(f"{f}_0{j}" for f in ("thumb", "index", "middle", "ring", "pinky") for j in (1, 2, 3))


def _reset_arm(rig, s):
    from mathutils import Matrix

    for n in _ARM_BONES:
        rig.pb[f"{n}_{s}"].matrix_basis = Matrix.Identity(4)
    rig.update()


def _arm_chain(rig, s, a, rigs, me, vec):
    """Place upper arm + forearm; returns (elbow, target) in world space."""
    T = point(a["target"], rigs, me)
    if a.get("elbow") is not None:
        # Phase 7: an elbow POINT for shapes where the elbow position is the technique (the RNC elbow under the chin,
        # the figure-four, an elbow strike): two-bone IK with the bend plane through that point — the hand still lands
        # exactly on the target (aiming the bones at the point instead let the hand overshoot the target)
        S = rig.head(f"upperarm_{s}")
        rig.ik2(f"upperarm_{s}", f"lowerarm_{s}", T, point(a["elbow"], rigs, me) - (S + T) / 2)
    else:
        rig.ik2(f"upperarm_{s}", f"lowerarm_{s}", T, vec(a["pole"]))
    return rig.head(f"lowerarm_{s}").copy(), T


def pose_arms(rig, st, rigs, me):
    for s in ("l", "r"):
        a = st["arms"][s]
        if "mixarm" in a:
            # Phase 7: blending an IK arm with an explicit-elbow arm — both are solved, then the elbow and the hand
            # target are interpolated in world space (no jump when one key places the elbow and the next does not)
            a0, a1, t = a["mixarm"]
            R0 = chest_rot(rig) if a0.get("space") == "chest" else None
            rig.memo = False  # trial solves: do not overwrite the continuity memory (rig_kit)
            Ea, Ta = _arm_chain(rig, s, a0, rigs, me, (lambda v: R0 @ rig.cv(*v)) if R0 is not None else (lambda v: rig.cv(*v)))
            _reset_arm(rig, s)
            Eb, Tb = _arm_chain(rig, s, a1, rigs, me, (lambda v: R0 @ rig.cv(*v)) if R0 is not None else (lambda v: rig.cv(*v)))
            _reset_arm(rig, s)
            rig.memo = True
            a = {k: v for k, v in blend({k: v for k, v in a0.items() if k not in ("elbow", "target", "pole")}, {k: v for k, v in a1.items() if k not in ("elbow", "target", "pole")}, t).items()}
            a["target"] = tuple(rig.to_char(Ta.lerp(Tb, t)))
            a["elbow"] = tuple(rig.to_char(Ea.lerp(Eb, t)))
        # Phase 7: space "chest" = pole / palm along the chest axes (they turn with the body, like the target Chest)
        R = chest_rot(rig) if a.get("space") == "chest" else None
        vec = (lambda v: R @ rig.cv(*v)) if R is not None else (lambda v: rig.cv(*v))  # noqa: E731
        _arm_chain(rig, s, a, rigs, me, vec)
        rig.hand_follow(s)
        if a.get("handAim"):
            # Phase 7: a hand flat on the mat / a partner — the hand points along handAim (actor frame) instead of
            # continuing the forearm, so the fingers lie on the surface rather than going through it
            w = a.get("handAimW", 1.0)
            f = rig.axis(f"lowerarm_{s}")
            rig.aim(f"hand_{s}", f.lerp(rig.cv(*a["handAim"]).normalized(), w))
        if a.get("palm"):
            rig.palm(s, vec(a["palm"]).normalized())
        if a.get("flex"):
            rig.hand_follow(s, a["flex"])  # wrist bent (a flat posted palm), after the palm roll
        if a.get("fist"):
            rig.fist(s)
        elif a.get("curl"):
            rig.fist(s, a["curl"])  # a gripping hand: fingers partly curled round a leg / an arm


def clearance(rig_a, bones_a, rig_b, bones_b):
    """Smallest distance (m) between the bone segments listed (head->tail) of two rigs — a coarse check that
    demonstration contacts stay contacts and the RNC arm never closes on the neck."""
    best = 1e9
    for na in bones_a:
        for nb in bones_b:
            a0, a1 = rig_a.head(na), rig_a.tail(na)
            b0, b1 = rig_b.head(nb), rig_b.tail(nb)
            for i in range(6):
                for j in range(6):
                    best = min(best, (a0.lerp(a1, i / 5) - b0.lerp(b1, j / 5)).length)
    return best


def _mx(v):
    return (-v[0],) + tuple(v[1:])


def _side(bone):
    return bone[:-2] + ("_r" if bone.endswith("_l") else "_l") if bone.endswith(("_l", "_r")) else bone


def mirror(st):
    """The same state in the opposite stance (Phase 6, two-person southpaw): each actor's own frame is reflected
    across its sagittal plane — left/right entries and bone references swap, lateral coordinates and yaw / roll change
    sign — and the IK is solved again on the real skeleton (not a mirrored picture). Both actors are mirrored, so their
    relative placement (B stands on A's centre line) reflects with them."""
    if isinstance(st, Ref):
        return Ref(st.who, _side(st.bone), st.at, _mx(st.off), st.frame)
    if isinstance(st, Chest):
        return Chest(st.who, _mx(st.off))
    if isinstance(st, _Lerp):
        # the ends of a point blend are points: a plain (x, y, z) end must be reflected too, not passed through
        pt = lambda v: _mx(v) if isinstance(v, tuple) else mirror(v)  # noqa: E731
        return _Lerp(pt(st.a), pt(st.b), st.t)
    if isinstance(st, dict):
        if set(st) >= {"l", "r"} and len(st) == 2:
            return {"l": mirror(st["r"]), "r": mirror(st["l"])}
        out = {}
        for k, v in st.items():
            if k in ("mix", "mixarm"):
                a, b, t = v
                out[k] = (mirror(a), mirror(b), t)
            elif k in ("yaw", "roll"):
                out[k] = -v
            elif k == "ball":
                out[k] = (-v[0], v[1])
            elif k == "clavicle" and isinstance(v, dict):
                out[k] = {"l": v.get("r", (0.0, 0.0)), "r": v.get("l", (0.0, 0.0))}
            elif k in ("pos", "target", "pole", "palm", "toes", "ankle", "gaze", "elbow", "handAim") and isinstance(v, tuple):
                out[k] = _mx(v)
            else:
                out[k] = mirror(v)
        return out
    return st


__all__ = ["mirror", "Ref", "Chest", "chest_rot", "blend", "deep", "keyed", "point", "pose_body", "pose_legs", "pose_head", "pose_arms", "clearance", "ease_in_out", "smoothstep", "math", "Vector"]
