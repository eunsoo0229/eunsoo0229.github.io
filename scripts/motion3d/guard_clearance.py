"""Retarget-stage clearance of a hand against the character's own torso (imported by retarget_hand_observed.py).

Why: mma-mocap retargets bone DIRECTIONS. The MakeHuman fighter has 33 % wider shoulders (43.9 vs 33.1 cm) and
a deeper chest than the captured mannequin, so a guard fist that sat ~11 cm in front of the source's shoulder
line ends up inside this character's chest (every frame of the jab clip; see data/audit/motion3d-jab-fullbody.json).

How: the torso is modelled from the rig's REST mesh (vertices whose largest weight is Spine/Spine1/Spine2/
shoulders) as convex cross-sections per 1 cm of height, in the rest armature frame. Each frame the posed hand
points (wrist, fist centre, knuckles, thumb joints; spheres of 1.1-4.5 cm) are mapped into that rest chest frame through the
posed Spine2 transform. If a sphere is inside, the wrist target moves along the chest's forward axis by the
smallest amount that clears it (+ margin), and the arm is re-solved by two-bone IK that keeps the current elbow
bend plane and the rig's bone lengths. If the forearm (elbow end) cuts into the torso side deeper than soft-tissue
contact (FOREARM_CONTACT_TOL), the elbow is swivelled about the shoulder->wrist axis by the smallest angle that
brings it within that (fist and bone lengths unchanged; total swivel capped).
The source joint directions handed to the retargeter are replaced by
those of the IK result, so the normal solver keys the corrected pose (no constraints). Frames without contact
are not touched.
"""
import json

import numpy as np

TORSO_GROUPS = {"mixamorig:Spine", "mixamorig:Spine1", "mixamorig:Spine2", "mixamorig:LeftShoulder", "mixamorig:RightShoulder", "DEF_LeftShoulder", "DEF_RightShoulder"}
# hand samples: (name, radius). Thumb joints matter: in a high guard the rear thumb reaches the opposite collarbone.
# The thumbs carry +1.5 cm: the opposite pectoral/collarbone skin is moved forward by DEF_*Shoulder (half the jab
# arm's swing, keyed after the solve), which this rigid rest-torso model does not see.
HAND_POINTS = [("wrist", 0.030), ("fist", 0.045), ("knuckle", 0.030), ("Thumb1", 0.030), ("Thumb2", 0.028), ("Thumb3", 0.026)]


def _unit(v):
    n = np.linalg.norm(v)
    return v / n if n > 1e-12 else v


def _hull(pts):
    """2-D convex hull (monotone chain), counter-clockwise."""
    pts = sorted(set(map(tuple, np.round(pts, 4))))
    if len(pts) < 3:
        return np.array(pts)

    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

    lo, hi = [], []
    for p in pts:
        while len(lo) >= 2 and cross(lo[-2], lo[-1], p) <= 0:
            lo.pop()
        lo.append(p)
    for p in reversed(pts):
        while len(hi) >= 2 and cross(hi[-2], hi[-1], p) <= 0:
            hi.pop()
        hi.append(p)
    return np.array(lo[:-1] + hi[:-1])


def _signed_dist(poly, q):
    """Signed distance from q to a CCW convex polygon (negative inside)."""
    best, inside = np.inf, True
    n = len(poly)
    for i in range(n):
        a, b = poly[i], poly[(i + 1) % n]
        e = b - a
        t = np.clip(np.dot(q - a, e) / np.dot(e, e), 0, 1)
        best = min(best, np.linalg.norm(q - (a + t * e)))
        if e[0] * (q[1] - a[1]) - e[1] * (q[0] - a[0]) < 0:
            inside = False
    return -best if inside else best


class TorsoProfile:
    """Rest torso as convex cross-sections (left x forward) per 1 cm of height. Convex hulls cover the chest front
    and corners (pectorals) that an ellipse would miss; they slightly over-cover concave spots (conservative)."""

    def __init__(self, pts_arm, left, up, fwd, bin_m=0.01):
        self.left, self.up, self.fwd = left, up, fwd
        h = pts_arm @ up
        xf = np.stack([pts_arm @ left, pts_arm @ fwd], axis=1)
        self.h0, self.bin = float(h.min()), bin_m
        n = int(np.ceil((h.max() - h.min()) / bin_m)) + 1
        self.sec = []
        for i in range(n):
            lo = self.h0 + (i - 1) * bin_m
            m = (h >= lo) & (h <= lo + 3 * bin_m)
            self.sec.append(_hull(xf[m]) if m.sum() >= 8 else None)

    def _poly(self, p):
        i = int(round((p @ self.up - self.h0) / self.bin))
        return self.sec[i] if 0 <= i < len(self.sec) else None

    def inside(self, p, r):
        """How deep sphere (p, r) reaches into the torso section (0 = clear), metres."""
        poly = self._poly(p)
        if poly is None or len(poly) < 3:
            return 0.0
        return max(0.0, r - _signed_dist(poly, np.array([p @ self.left, p @ self.fwd])))

    def push(self, p, r, step=0.002, limit=0.3):
        """Forward distance that moves sphere (p, r) out of the torso section; 0 if it is already clear."""
        poly = self._poly(p)
        if poly is None or len(poly) < 3:
            return 0.0
        q = np.array([p @ self.left, p @ self.fwd])
        d = 0.0
        while d < limit and _signed_dist(poly, q + np.array([0.0, d])) < r:
            d += step
        return d


def two_bone_ik(S, E, W, target):
    L1, L2 = np.linalg.norm(E - S), np.linalg.norm(W - E)
    d_vec = target - S
    d = min(np.linalg.norm(d_vec), L1 + L2 - 1e-4)
    u = _unit(d_vec)
    v = _unit((E - S) - np.dot(E - S, u) * u)  # keep the current bend side / plane
    cos_a = np.clip((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d), -1, 1)
    E2 = S + L1 * (cos_a * u + np.sqrt(1 - cos_a * cos_a) * v)
    W2 = E2 + L2 * _unit(S + u * d - E2)
    return E2, W2


def rot_between_vec(a, b):
    """Smallest rotation matrix taking direction a to direction b."""
    a, b = _unit(a), _unit(b)
    v = np.cross(a, b)
    c = float(np.dot(a, b))
    if np.linalg.norm(v) < 1e-9:
        return np.eye(3)
    vx = np.array([[0, -v[2], v[1]], [v[2], 0, -v[0]], [-v[1], v[0], 0]])
    return np.eye(3) + vx + vx @ vx * (1.0 / (1.0 + c))


def rotate_about(v, axis, ang):
    axis = _unit(axis)
    return v * np.cos(ang) + np.cross(axis, v) * np.sin(ang) + axis * np.dot(axis, v) * (1 - np.cos(ang))


FOREARM_POINTS = [(0.0, 0.035), (1 / 3, 0.032), (2 / 3, 0.030)]  # fraction elbow->wrist, radius


# An elbow tucked against the ribs is normal in a guard: forearm skin pressing into the side up to this depth is
# treated as soft-tissue contact. Only deeper interpenetration swivels the elbow (clearing it fully needs ~45 deg
# and lays the guard forearm flat across the chest — an unnatural guard).
FOREARM_CONTACT_TOL = 0.015


def elbow_swivel(S, E, W, depth_of, max_deg=45, tol=FOREARM_CONTACT_TOL):
    """Smallest rotation of the elbow about the shoulder->wrist axis that brings the forearm's penetration of the
    torso within `tol` (wrist and bone lengths unchanged). Returns (E2, angle_deg, residual_depth)."""
    def depth(Ec):
        return max(depth_of(Ec + f * (W - Ec), r) for f, r in FOREARM_POINTS)

    d0 = depth(E)
    if d0 <= tol:
        return E, 0.0, d0
    best = (d0, 0.0, E)
    for k in range(1, max_deg + 1):
        for sgn in (1, -1):
            Ec = S + rotate_about(E - S, W - S, np.radians(sgn * k))
            dk = depth(Ec)
            if dk <= tol:
                return Ec, float(sgn * k), dk
            if dk < best[0]:
                best = (dk, float(sgn * k), Ec)
    return best[2], best[1], best[0]


def install(Retargeter, margin=0.01, sides=("right", "left"), report_path=None, swivel_max_deg=45):
    import bpy

    state = {"profile": None, "rows": [], "frame": 0}

    def build_profile(rt):
        arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
        mesh = next(o for o in bpy.data.objects if o.type == "MESH")
        to_arm = np.array(arm.matrix_world.inverted() @ mesh.matrix_world)
        groups = {g.index: g.name for g in mesh.vertex_groups}
        pts = []
        for v in mesh.data.vertices:
            best = max(v.groups, key=lambda g: g.weight, default=None)
            if best and groups[best.group] in TORSO_GROUPS:
                pts.append((to_arm @ np.array([*v.co, 1.0]))[:3])
        ax = rt.axes
        return TorsoProfile(np.array(pts), _unit(ax["left"]), _unit(ax["up"]), _unit(ax["forward"]))

    orig = Retargeter.solve

    def solve(self, P, swing_weights=None):
        if state["profile"] is None:
            state["profile"] = build_profile(self)
        prof = state["profile"]
        basis, pose = orig(self, P, swing_weights)
        heads = self.fk_heads(pose)
        sp = "mixamorig:Spine2"
        to_rest = self.rest[sp]["R"] @ pose[sp].T  # posed -> rest rotation (armature space)
        fwd_posed = pose[sp] @ self.rest[sp]["R"].T @ prof.fwd
        row = {"frame": state["frame"]}
        P2 = None
        for side in sides:
            Sd = side.capitalize()
            W = heads[f"mixamorig:{Sd}Hand"]
            K = heads[f"mixamorig:{Sd}HandMiddle1"]
            S, E = heads[f"mixamorig:{Sd}Arm"], heads[f"mixamorig:{Sd}ForeArm"]
            to_chest = lambda p: self.rest[sp]["head"] + to_rest @ (p - heads[sp])
            depth_of = lambda p, r: prof.inside(to_chest(p), r + margin / 2)
            # hand points as offsets from the wrist; the hand follows the forearm, so they turn with it
            offs = {"knuckle": K - W, "fist": (K - W) / 2, "wrist": np.zeros(3)}
            for t in ("Thumb1", "Thumb2", "Thumb3"):
                offs[t] = heads[f"mixamorig:{Sd}Hand{t}"] - W

            def hand_need(Wc, R):
                return max(prof.push(to_chest(Wc + R @ offs[n]), r) for n, r in HAND_POINTS)

            # Alternate the two fixes until both hold: fist forward out of the chest (IK), then elbow swivel out of
            # the torso side.
            E2, W2, R2 = E, W, np.eye(3)
            push_total, ang_total, resid = 0.0, 0.0, 0.0
            for _ in range(8):
                need = hand_need(W2, R2)
                if need > 0:
                    E3, W3 = two_bone_ik(S, E2, W2, W2 + fwd_posed * (need + margin))
                    R2 = rot_between_vec(W2 - E2, W3 - E3) @ R2
                    E2, W2 = E3, W3
                    push_total += need + margin
                ang = 0.0
                left_deg = int(swivel_max_deg - abs(ang_total))
                if left_deg > 0:
                    E3, ang, resid = elbow_swivel(S, E2, W2, depth_of, left_deg)
                    if ang:
                        R2 = rot_between_vec(W2 - E2, W2 - E3) @ R2
                        E2 = E3
                        ang_total += ang
                if need <= 0 and ang == 0.0:
                    break
            row[side] = round(float(push_total), 4)
            row[side + "SwivelDeg"] = ang_total
            row[side + "ResidualMm"] = round(resid * 1000, 1)
            row[side + "HandResidualMm"] = round(hand_need(W2, R2) * 1000, 1)
            if push_total <= 0 and ang_total == 0.0:
                continue
            P2 = dict(P) if P2 is None else P2
            s, e, w = f"{side}_shoulder", f"{side}_elbow", f"{side}_wrist"
            le, lw = np.linalg.norm(P[e] - P[s]), np.linalg.norm(P[w] - P[e])
            P2[e] = P[s] + _unit(E2 - S) * le
            P2[w] = P2[e] + _unit(W2 - E2) * lw
            dw = P2[w] - P[w]
            for h in (f"{side}_index", f"{side}_pinky", f"{side}_thumb", f"{side}_hand_mid"):
                if h in P:
                    P2[h] = P[h] + dw
        state["rows"].append(row)
        state["frame"] += 1
        if P2 is not None:
            basis, pose = orig(self, P2, swing_weights)
        if report_path:
            json.dump({"marginM": margin, "pushM": state["rows"]}, open(report_path, "w"), indent=0)
        return basis, pose

    Retargeter.solve = solve
